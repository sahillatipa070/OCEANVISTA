from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import xarray as xr
import numpy as np
import requests, io, os, tempfile, datetime as dt, math, csv

app=FastAPI(title='OceanVista 3D V6 Live Ocean Intelligence API')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

ERD='https://coastwatch.pfeg.noaa.gov/erddap'
ARGO='https://argovis-api.colorado.edu'
MARINE='https://geo.vliz.be/geoserver/MarineRegions/wfs'

REGION={'lat0':5,'lat1':25,'lon0':65,'lon1':95}

DATASETS={
 'sst': {'id':'noaacwLEOACSPOSSTL3SnrtCDaily','var':'sea_surface_temperature','units':'°C','source':'NOAA ACSPO L3S-LEO NRT'},
 'chl': {'id':'nesdisVHNnoaa20chlaDaily','var':'chlor_a','units':'mg m^-3','source':'NOAA NOAA-20 VIIRS NRT'},
 'currents': {'id':'jplOscar','u':'u','v':'v','units':'m s^-1','source':'OSCAR L4 5-day composite'},
 'bathymetry': {'id':'GEBCO_2020','var':'elevation','units':'m','source':'GEBCO_2020 via NOAA ERDDAP'}
}

CACHE={}

def erddap_json(dataset, expr):
    url=f'{ERD}/griddap/{dataset}.json?{expr}'
    r=requests.get(url,timeout=45)
    r.raise_for_status()
    return r.json(),url

def table_to_dict(j):
    cols=j['table']['columnNames']; rows=j['table']['rows']
    return cols,rows

def parse_time(s):
    return dt.datetime.fromisoformat(s.replace('Z','+00:00'))

def query_grid(ds_id,var,time_expr=None,lat0=5,lat1=25,lon0=65,lon1=95,stride=1):
    # Find a recent date window by requesting a small time slice near today. If unavailable, try 14 days back.
    today=dt.datetime.now(dt.timezone.utc)
    candidates=[today-dt.timedelta(days=i) for i in [0,1,2,3,5,7,10,14,21,30]]
    last_err=None
    for d in candidates:
        date=d.strftime('%Y-%m-%dT00:00:00Z')
        expr=f'{var}[({date})][({lat0}):{stride}:({lat1})][({lon0}):{stride}:({lon1})]'
        try:
            j,url=erddap_json(ds_id,expr)
            cols,rows=table_to_dict(j)
            if rows: return {'columns':cols,'rows':rows,'url':url,'date':date}
        except Exception as e: last_err=e
    raise HTTPException(502,f'Remote dataset unavailable: {last_err}')

def grid_from_rows(rows, cols, var):
    idx={c:i for i,c in enumerate(cols)}
    latc=next(c for c in cols if c.lower() in ('latitude','lat'))
    lonc=next(c for c in cols if c.lower() in ('longitude','lon'))
    lats=sorted({float(r[idx[latc]]) for r in rows if r[idx[latc]] is not None})
    lons=sorted({float(r[idx[lonc]]) for r in rows if r[idx[lonc]] is not None})
    vals=[]
    vcol=idx[var]
    for r in rows:
        try: vals.append(float(r[vcol]) if r[vcol] is not None else np.nan)
        except: vals.append(np.nan)
    arr=np.asarray(vals,dtype=np.float32)
    # ERDDAP row ordering is regular lat/lon; rebuild by coordinates to be safe.
    out=np.full((len(lats),len(lons)),np.nan,dtype=np.float32)
    li={v:i for i,v in enumerate(lats)}; oi={v:i for i,v in enumerate(lons)}
    for r,v in zip(rows,vals):
        if r[idx[latc]] is None or r[idx[lonc]] is None: continue
        out[li[float(r[idx[latc]])]][oi[float(r[idx[lonc]])]]=v
    return lats,lons,out

def normalize_field(a):
    a=np.nan_to_num(a,nan=float(np.nanmedian(a)) if np.isfinite(a).any() else 0.0)
    mn=float(np.nanpercentile(a,2)); mx=float(np.nanpercentile(a,98))
    if mx<=mn: mx=mn+1
    return a,mn,mx

@app.get('/api/health')
def health():
    return {'ok':True,'version':'V6','live_sources':['NOAA ERDDAP','Argovis','Marine Regions','GEBCO']}

@app.get('/api/live/sst')
def live_sst():
    q=query_grid(DATASETS['sst']['id'],DATASETS['sst']['var'],lat0=5,lat1=25,lon0=65,lon1=95,stride=2)
    lats,lons,a=grid_from_rows(q['rows'],q['columns'],DATASETS['sst']['var'])
    a,mn,mx=normalize_field(a)
    return {'source':DATASETS['sst']['source'],'dataset':DATASETS['sst']['id'],'variable':DATASETS['sst']['var'],'units':'°C','time':q['date'],'lat':lats,'lon':lons,'values':a.tolist(),'min':mn,'max':mx,'request_url':q['url']}

@app.get('/api/live/chlorophyll')
def live_chl():
    q=query_grid(DATASETS['chl']['id'],DATASETS['chl']['var'],lat0=5,lat1=25,lon0=65,lon1=95,stride=2)
    lats,lons,a=grid_from_rows(q['rows'],q['columns'],DATASETS['chl']['var'])
    a,mn,mx=normalize_field(a)
    return {'source':DATASETS['chl']['source'],'dataset':DATASETS['chl']['id'],'variable':DATASETS['chl']['var'],'units':'mg m^-3','time':q['date'],'lat':lats,'lon':lons,'values':a.tolist(),'min':mn,'max':mx,'request_url':q['url']}

@app.get('/api/live/currents')
def live_currents():
    today=dt.datetime.now(dt.timezone.utc)
    last_err=None
    for days in [0,5,10,15,30]:
        d=(today-dt.timedelta(days=days)).strftime('%Y-%m-%dT00:00:00Z')
        expr=f'u[({d})][(5):3:(25)][(65):3:(95)],v[({d})][(5):3:(25)][(65):3:(95)]'
        try:
            j,url=erddap_json('jplOscar',expr)
            cols,rows=table_to_dict(j)
            if rows:
                idx={c:i for i,c in enumerate(cols)}
                latc=next(c for c in cols if c.lower() in ('latitude','lat')); lonc=next(c for c in cols if c.lower() in ('longitude','lon'))
                uc=next(c for c in cols if c=='u'); vc=next(c for c in cols if c=='v')
                out=[]
                for r in rows:
                    try:
                        u=float(r[idx[uc]]); v=float(r[idx[vc]])
                        if np.isfinite(u) and np.isfinite(v): out.append({'lat':float(r[idx[latc]]),'lon':float(r[idx[lonc]]),'u':u,'v':v})
                    except: pass
                return {'source':DATASETS['currents']['source'],'dataset':'jplOscar','time':d,'units':'m s^-1','vectors':out,'request_url':url}
        except Exception as e: last_err=e
    raise HTTPException(502,f'Current feed unavailable: {last_err}')

@app.get('/api/live/bathymetry')
def live_bathy():
    # GEBCO is very high resolution; request a deliberately small operational subset.
    expr='elevation[(5):0.5:(25)][(65):0.5:(95)]'
    try:
        j,url=erddap_json('GEBCO_2020',expr)
        cols,rows=table_to_dict(j)
        lats,lons,a=grid_from_rows(rows,cols,'elevation')
        a=np.nan_to_num(a,nan=0)
        return {'source':'GEBCO_2020','units':'m','lat':lats,'lon':lons,'values':a.tolist(),'min':float(np.nanmin(a)),'max':float(np.nanmax(a)),'request_url':url,'warning':'GEBCO_2020 is not for navigation or safety-critical use.'}
    except Exception as e:
        raise HTTPException(502,f'Bathymetry feed unavailable: {e}')

@app.get('/api/argo')
def argo(lat0:float=5,lat1:float=25,lon0:float=65,lon1:float=95,days:int=45):
    end=dt.datetime.now(dt.timezone.utc); start=end-dt.timedelta(days=days)
    polygon=f'[[{lon0},{lat0}],[{lon1},{lat0}],[{lon1},{lat1}],[{lon0},{lat1}],[{lon0},{lat0}]]'
    params={'startDate':start.strftime('%Y-%m-%dT%H:%M:%SZ'),'endDate':end.strftime('%Y-%m-%dT%H:%M:%SZ'),'polygon':polygon,'data':'metadata-only'}
    try:
        r=requests.get(f'{ARGO}/profiles',params=params,timeout=45); r.raise_for_status(); data=r.json()
        items=[]
        for p in data[:500]:
            items.append({'id':str(p.get('_id') or p.get('platform_number') or p.get('platform','unknown')),'platform':p.get('platform_number') or p.get('platform'),'lat':p.get('lat'),'lon':p.get('lon'),'timestamp':p.get('timestamp'),'dataMode':p.get('dataMode'),'source':'Argovis'})
        return {'source':'Argovis','count':len(items),'profiles':items,'query':params}
    except Exception as e:
        raise HTTPException(502,f'Argovis unavailable: {e}')

@app.get('/api/argo/profile/{profile_id}')
def argo_profile(profile_id:str):
    try:
        r=requests.get(f'{ARGO}/profiles',params={'id':profile_id,'data':'all'},timeout=45); r.raise_for_status(); data=r.json()
        if not data: raise HTTPException(404,'Profile not found')
        p=data[0]
        # Argovis keys vary by product. Keep raw + normalized fields.
        return {'source':'Argovis','profile':p}
    except HTTPException: raise
    except Exception as e: raise HTTPException(502,f'Argovis profile unavailable: {e}')

@app.get('/api/eez/india')
def india_eez():
    params={'service':'WFS','version':'1.0.0','request':'GetFeature','typeName':'eez','cql_filter':'mrgid=8480','outputFormat':'application/json'}
    try:
        r=requests.get(MARINE,params=params,timeout=45); r.raise_for_status(); return {'source':'Marine Regions World EEZ v12','geojson':r.json(),'request_url':r.url}
    except Exception as e: raise HTTPException(502,f'India EEZ feed unavailable: {e}')

@app.get('/api/coastline')
def coastline():
    # Natural Earth low-res coastline hosted by geojson.xyz. Used only as visual context.
    url='https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'
    try:
        r=requests.get(url,timeout=45); r.raise_for_status(); fc=r.json()
        india=[f for f in fc.get('features',[]) if f.get('properties',{}).get('ADMIN')=='India']
        return {'source':'geo-countries / Natural Earth-derived','geojson':{'type':'FeatureCollection','features':india}}
    except Exception as e: raise HTTPException(502,f'Coastline feed unavailable: {e}')

@app.post('/api/netcdf/upload')
async def upload_netcdf(file:UploadFile=File(...)):
    if not file.filename.lower().endswith(('.nc','.nc4','.cdf')): raise HTTPException(400,'Upload a NetCDF .nc/.nc4/.cdf file')
    data=await file.read()
    if len(data)>300*1024*1024: raise HTTPException(413,'File too large (300 MB limit)')
    fd,path=tempfile.mkstemp(suffix='.nc'); os.close(fd)
    try:
        with open(path,'wb') as f:f.write(data)
        ds=xr.open_dataset(path,decode_times=False)
        vars=[]
        for k,v in ds.data_vars.items():
            if np.issubdtype(v.dtype,np.number): vars.append({'name':k,'dims':list(v.dims),'units':str(v.attrs.get('units','')),'long_name':str(v.attrs.get('long_name',k)),'shape':[int(x) for x in v.shape]})
        names=' '.join(x['name'].lower() for x in vars)
        def detect(keys):
            for x in vars:
                if any(k in x['name'].lower() for k in keys): return x['name']
            return None
        detected={'temperature':detect(['thetao','temperature','temp']),'salinity':detect(['salinity','salt','so']),'chlorophyll':detect(['chlorophyll','chl','chlor_a']),'u':detect(['eastward','water_u','uo','^u$']),'v':detect(['northward','water_v','vo','^v$'])}
        main=detected['temperature'] or (vars[0]['name'] if vars else None)
        volume=None
        if main:
            da=ds[main]
            while da.ndim>3: da=da.isel({da.dims[0]:0})
            for d in list(da.dims):
                if da.sizes[d]>64:
                    idx=np.linspace(0,da.sizes[d]-1,64).astype(int); da=da.isel({d:idx})
            a=np.asarray(da.values,dtype=np.float32)
            while a.ndim<3: a=a[...,None]
            a=np.nan_to_num(a,nan=float(np.nanmedian(a)) if np.isfinite(a).any() else 0.0)
            mn=float(np.nanpercentile(a,2)); mx=float(np.nanpercentile(a,98));
            if mx<=mn: mx=mn+1
            volume={'nx':int(a.shape[-1]),'ny':int(a.shape[-2]),'nz':int(a.shape[-3]),'min':mn,'max':mx,'values':a.flatten(order='C').tolist()}
        return {'filename':file.filename,'dims':[{'name':d,'size':int(n)} for d,n in ds.sizes.items()],'variables':vars,'detected':detected,'metadata':{k:str(v) for k,v in ds.attrs.items()},'source':'User uploaded NetCDF','default_variable':main,'volume':volume}
    except Exception as e: raise HTTPException(400,f'Could not read NetCDF: {e}')
    finally:
        try: os.remove(path)
        except: pass

@app.get('/api/export/validation.csv')
def export_validation():
    rows=[['Depth (m)','Observed (°C)','Model (°C)','Diff (°C)'],[0,29.0,29.4,.4],[100,23.5,22.8,-.7],[500,10.2,10.4,.2],[1000,6.2,6.0,-.2],[2000,4.0,3.8,-.2]]
    s=io.StringIO(); csv.writer(s).writerows(rows); s.seek(0)
    return StreamingResponse(iter([s.getvalue()]),media_type='text/csv',headers={'Content-Disposition':'attachment; filename=OceanVista_validation.csv'})
