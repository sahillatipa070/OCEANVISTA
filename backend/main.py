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

# ---- V8 MVP real uploaded-dataset workflow ----
from pathlib import Path
from uuid import uuid4
from typing import Optional
import pandas as pd
UPLOAD_ROOT=Path(__file__).parent/'uploads'; UPLOAD_ROOT.mkdir(exist_ok=True)
USER_DATASETS={}

def _coord(ds, names):
    allnames=list(ds.coords)+list(ds.dims)+list(ds.variables)
    low={n.lower():n for n in allnames}
    for n in names:
        if n in low:return low[n]
    for k,v in low.items():
        if any(n in k for n in names):return v
    return None

def _meta_netcdf(path, kind):
    ds=xr.open_dataset(path,decode_times=True)
    lat=_coord(ds,['latitude','lat']); lon=_coord(ds,['longitude','lon']); depth=_coord(ds,['depth','pres','pressure','lev','z']); time=_coord(ds,['time','juld','date'])
    vars=[{'name':k,'dims':list(v.dims),'units':str(v.attrs.get('units','')),'long_name':str(v.attrs.get('long_name',k))} for k,v in ds.data_vars.items() if np.issubdtype(v.dtype,np.number)]
    errors=[]
    required=['latitude','longitude','depth','time']
    found={'latitude':lat,'longitude':lon,'depth':depth,'time':time}
    for x in required:
        if not found[x]: errors.append(f'{x.title()} coordinate missing')
    if kind=='model' and not vars: errors.append('No numeric scientific variables found')
    def rng(n):
        if not n:return None
        try:
            a=np.asarray(ds[n].values).astype(float); a=a[np.isfinite(a)]
            return {'min':float(a.min()),'max':float(a.max()),'count':int(a.size)} if a.size else None
        except:return {'count':int(ds.sizes.get(n,0))}
    missing={}
    for v in vars[:20]:
        try:
            a=np.asarray(ds[v['name']].values); missing[v['name']]=int(np.isnan(a).sum()) if np.issubdtype(a.dtype,np.floating) else 0
        except: missing[v['name']]=0
    times=[]
    if time:
        try:
            tv=np.asarray(ds[time].values).ravel()
            times=[str(x) for x in tv[:120]]
        except: times=[]
    return {'dimensions':[{'name':d,'size':int(n)} for d,n in ds.sizes.items()], 'variables':vars, 'coordinates':found,
            'ranges':{k:rng(v) for k,v in found.items()}, 'missing_values':missing, 'times':times,
            'validation':{'valid':not errors,'errors':errors,'warnings':[]}}

def _meta_tabular(path):
    ext=Path(path).suffix.lower(); sep=None if ext in ('.csv','.txt','.asc','.ascii') else ','
    try: df=pd.read_csv(path,sep=sep,engine='python')
    except: df=pd.read_csv(path,delim_whitespace=True)
    cols=list(df.columns); low={c.lower():c for c in cols}
    def pick(keys): return next((c for k,c in low.items() if any(x in k for x in keys)),None)
    coords={'latitude':pick(['latitude','lat']),'longitude':pick(['longitude','lon']),'depth':pick(['depth','pres','pressure']),'time':pick(['time','date'])}
    errors=[f'{k.title()} column missing' for k,v in coords.items() if not v]
    variables=[{'name':c,'dims':['record'],'units':''} for c in cols if c not in coords.values() and pd.api.types.is_numeric_dtype(df[c])]
    return {'dimensions':[{'name':'record','size':int(len(df))}], 'variables':variables,'coordinates':coords,
            'ranges':{},'missing_values':{c:int(df[c].isna().sum()) for c in cols},'validation':{'valid':not errors,'errors':errors,'warnings':[]}}

@app.post('/api/datasets/upload/{kind}')
async def upload_dataset(kind:str,file:UploadFile=File(...)):
    if kind not in ('model','argo','observation'): raise HTTPException(400,'Invalid dataset type')
    ext=Path(file.filename or '').suffix.lower(); allowed={'.nc','.nc4','.cdf'} if kind!='observation' else {'.csv','.txt','.asc','.ascii','.nc','.nc4','.cdf'}
    if ext not in allowed: raise HTTPException(400,f'Unsupported file type {ext}')
    did=f'{kind}_{uuid4().hex[:12]}'; path=UPLOAD_ROOT/f'{did}{ext}'
    size=0
    with open(path,'wb') as out:
        while True:
            chunk=await file.read(1024*1024)
            if not chunk: break
            size+=len(chunk)
            if size>500*1024*1024: out.close(); path.unlink(missing_ok=True); raise HTTPException(413,'500 MB limit exceeded')
            out.write(chunk)
    try: meta=_meta_netcdf(path,kind) if ext in ('.nc','.nc4','.cdf') else _meta_tabular(path)
    except Exception as e: path.unlink(missing_ok=True); raise HTTPException(400,f'Could not read dataset: {e}')
    USER_DATASETS[did]={'id':did,'kind':kind,'filename':file.filename,'path':str(path),'metadata':meta,'uploaded_at':dt.datetime.now(dt.timezone.utc).isoformat()}
    return {'success':True,'dataset_id':did,'dataset_type':kind,'filename':file.filename,'status':'ready' if meta['validation']['valid'] else 'invalid','metadata':meta,'validation':meta['validation']}

@app.get('/api/datasets')
def list_datasets(): return [{k:v[k] for k in ('id','kind','filename','uploaded_at','metadata')} for v in USER_DATASETS.values()]

@app.get('/api/datasets/{dataset_id}/metadata')
def dataset_metadata(dataset_id:str):
    d=USER_DATASETS.get(dataset_id)
    if not d: raise HTTPException(404,'Dataset not found')
    return {'dataset_id':dataset_id,'dataset_type':d['kind'],'filename':d['filename'],'metadata':d['metadata']}

@app.delete('/api/datasets/{dataset_id}')
def delete_dataset(dataset_id:str):
    d=USER_DATASETS.pop(dataset_id,None)
    if not d: raise HTTPException(404,'Dataset not found')
    Path(d['path']).unlink(missing_ok=True); return {'success':True}


# ---- Real model/Argo profile matching workflow ----

def _dataset(dataset_id: str, expected: str | None = None):
    d=USER_DATASETS.get(dataset_id)
    if not d: raise HTTPException(404, 'Uploaded dataset not found. Upload the dataset again after restarting the backend.')
    if expected and d['kind'] != expected: raise HTTPException(400, f'Expected a {expected} dataset')
    return d

def _open_uploaded(dataset_id: str):
    return xr.open_dataset(_dataset(dataset_id)['path'], decode_times=True)

def _find_var(ds, requested: str):
    aliases={
      'Temperature (°C)':['temperature','temp','thetao','temp_adjusted','temp'],
      'Salinity (PSU)':['salinity','salt','so','psal','psal_adjusted'],
      'Chlorophyll (mg/m³)':['chlorophyll','chlor_a','chl','chla'],
      'Dissolved Oxygen':['oxygen','dissolved_oxygen','doxy','do'],
      'Ocean Current Speed':['current_speed','speed','velocity']
    }
    candidates=aliases.get(requested,[requested.lower()])
    numeric=[k for k,v in ds.data_vars.items() if np.issubdtype(v.dtype,np.number)]
    for a in candidates:
        for k in numeric:
            if a == k.lower() or a in k.lower(): return k
    return numeric[0] if numeric else None

def _to_num(a):
    a=np.asarray(a)
    try: return a.astype(float)
    except: return np.array([float(x) if str(x).strip() else np.nan for x in a.ravel()]).reshape(a.shape)

def _argo_profile_dim(ds, depth_name, lat_name):
    if lat_name and ds[lat_name].ndim: return ds[lat_name].dims[0]
    if depth_name and ds[depth_name].ndim>1: return ds[depth_name].dims[0]
    for d,n in ds.sizes.items():
        if d.lower() in ('profile','n_prof','prof','cast'): return d
    return next(iter(ds.sizes), None)

def _profile_depth(ds, depth_name, profile_dim, idx):
    da=ds[depth_name]
    if profile_dim in da.dims: da=da.isel({profile_dim:idx})
    return _to_num(da.values).ravel()

def _profile_scalar(ds, name, profile_dim, idx):
    if not name: return None
    da=ds[name]
    if profile_dim in da.dims: da=da.isel({profile_dim:idx})
    a=np.asarray(da.values).ravel()
    return a[0].item() if len(a) and hasattr(a[0], 'item') else (a[0] if len(a) else None)

def _profile_id(ds, profile_dim, idx):
    for name in ['float_id','platform_number','wmo','platform','profile_id']:
        if name in ds.variables:
            v=_profile_scalar(ds,name,profile_dim,idx)
            if v is not None: return str(v)
    return f'Profile {idx+1}'

def _read_tabular_dataset(d):
    ext=Path(d['path']).suffix.lower()
    try: return pd.read_csv(d['path'], sep=None, engine='python')
    except: return pd.read_csv(d['path'], delim_whitespace=True)

def _pick_col(df, keys):
    low={str(c).lower():c for c in df.columns}
    for k,c in low.items():
        if any(x in k for x in keys): return c
    return None

def _tabular_profiles(d, variable):
    df=_read_tabular_dataset(d); latc=_pick_col(df,['latitude','lat']); lonc=_pick_col(df,['longitude','lon']); depc=_pick_col(df,['depth','pres','pressure']); timec=_pick_col(df,['time','date'])
    if not (latc and lonc and depc): raise HTTPException(400,'CSV/ASCII needs latitude, longitude and depth columns')
    # Group by explicit profile/cast/id, otherwise all rows form one profile.
    gid=_pick_col(df,['profile','cast','station','float_id','wmo'])
    groups=list(df.groupby(gid, sort=False)) if gid else [('Observation 1',df)]
    out=[]
    for i,(name,g) in enumerate(groups):
        out.append({'index':i,'id':str(name),'latitude':float(pd.to_numeric(g[latc],errors='coerce').dropna().iloc[0]),'longitude':float(pd.to_numeric(g[lonc],errors='coerce').dropna().iloc[0]),'time':str(g[timec].dropna().iloc[0]) if timec and g[timec].notna().any() else None,'max_depth':float(pd.to_numeric(g[depc],errors='coerce').max())})
    return {'dataset_id':d['id'],'profiles':out,'count':len(out),'variable':variable}

def _validate_tabular_profile(model_d, obs_d, profile_index, variable):
    df=_read_tabular_dataset(obs_d); latc=_pick_col(df,['latitude','lat']); lonc=_pick_col(df,['longitude','lon']); depc=_pick_col(df,['depth','pres','pressure']); timec=_pick_col(df,['time','date']); gid=_pick_col(df,['profile','cast','station','float_id','wmo'])
    groups=list(df.groupby(gid, sort=False)) if gid else [('Observation 1',df)]
    if profile_index<0 or profile_index>=len(groups): raise HTTPException(400,'Invalid observation profile index')
    pid,g=groups[profile_index]
    vcol=_pick_col(g, {'Temperature (°C)':['temperature','temp','thetao'], 'Salinity (PSU)':['salinity','salt','psal'], 'Chlorophyll (mg/m³)':['chlorophyll','chl'], 'Dissolved Oxygen':['oxygen','doxy']}.get(variable,[variable.lower()]))
    if not vcol: raise HTTPException(400,f'Observation column not found for {variable}')
    g=g.copy(); g['_depth']=pd.to_numeric(g[depc],errors='coerce'); g['_obs']=pd.to_numeric(g[vcol],errors='coerce'); g=g[np.isfinite(g['_depth']) & np.isfinite(g['_obs'])]
    if len(g)<2: raise HTTPException(400,'Not enough valid observation samples')
    mds=xr.open_dataset(model_d['path'],decode_times=True)
    try:
        mvar=_find_var(mds,variable); mlat=_coord(mds,['latitude','lat']); mlon=_coord(mds,['longitude','lon']); mdepth=_coord(mds,['depth','lev','z'])
        if not (mvar and mlat and mlon and mdepth): raise HTTPException(400,'Model variable or coordinates missing')
        mda=mds[mvar]; lat=float(g[latc].iloc[0]); lon=float(g[lonc].iloc[0]);
        if mlat in mda.dims: mda=mda.sel({mlat:lat},method='nearest')
        if mlon in mda.dims: mda=mda.sel({mlon:lon},method='nearest')
        mt=_coord(mds,['time','date'])
        if mt and mt in mda.dims: mda=mda.isel({mt:0})
        extra=[x for x in mda.dims if x!=mdepth]
        if extra: mda=mda.mean(dim=extra,skipna=True)
        md=_to_num(mds[mdepth].values).ravel(); mv=_to_num(mda.values).ravel(); good=np.isfinite(md)&np.isfinite(mv); md=md[good]; mv=mv[good]; order=np.argsort(md); md=md[order]; mv=mv[order]
        model=np.interp(g['_depth'].to_numpy(),md,mv,left=np.nan,right=np.nan); rows=[{'depth':float(d),'observed':float(o),'model':float(mm),'diff':float(mm-o)} for d,o,mm in zip(g['_depth'],g['_obs'],model) if np.isfinite(mm)]
        if not rows: raise HTTPException(400,'No overlapping model/observation depths')
        diff=np.array([r['diff'] for r in rows]); ob=np.array([r['observed'] for r in rows]); mo=np.array([r['model'] for r in rows]); corr=float(np.corrcoef(ob,mo)[0,1]) if len(rows)>1 and np.std(ob)>0 and np.std(mo)>0 else 0.0
        return {'source':'real_uploaded_csv_observation','model_dataset':model_d['filename'],'argo_dataset':obs_d['filename'],'variable':variable,'profile_index':profile_index,'instrument':{'id':str(pid),'type':'Observation Profile','latitude':lat,'longitude':lon,'time':str(g[timec].iloc[0]) if timec else None,'max_depth':float(g['_depth'].max()),'variables':[vcol]},'rows':rows,'metrics':{'bias':float(diff.mean()),'mae':float(np.abs(diff).mean()),'rmse':float(np.sqrt(np.mean(diff**2))),'correlation':corr,'samples':len(rows)},'match':{'method':'nearest latitude/longitude + linear depth interpolation'}}
    finally: mds.close()

@app.get('/api/datasets/{dataset_id}/profiles')
def uploaded_profiles(dataset_id:str, variable:str='Temperature (°C)'):
    d=_dataset(dataset_id);
    if d['kind']=='observation':
        return _tabular_profiles(d, variable)
    if d['kind']!='argo': raise HTTPException(400,'Profiles require Argo NetCDF or CSV/ASCII observations')
    ds=_open_uploaded(dataset_id)
    try:
        latn=_coord(ds,['latitude','lat']); lonn=_coord(ds,['longitude','lon']); depthn=_coord(ds,['depth','pres','pressure','lev','z']); timen=_coord(ds,['time','juld','date'])
        pdim=_argo_profile_dim(ds,depthn,latn); n=int(ds.sizes.get(pdim,1))
        out=[]
        for i in range(n):
            lat=_profile_scalar(ds,latn,pdim,i); lon=_profile_scalar(ds,lonn,pdim,i); tm=_profile_scalar(ds,timen,pdim,i)
            dep=_profile_depth(ds,depthn,pdim,i) if depthn else np.array([])
            out.append({'index':i,'id':_profile_id(ds,pdim,i),'latitude':None if lat is None else float(lat),'longitude':None if lon is None else float(lon),'time':None if tm is None else str(tm),'max_depth':float(np.nanmax(dep)) if dep.size and np.isfinite(dep).any() else None})
        return {'dataset_id':dataset_id,'profiles':out,'count':len(out),'variable':variable}
    finally: ds.close()

@app.get('/api/validation/profile')
def real_validation_profile(model_id:str=Query(...), argo_id:str=Query(...), profile_index:int=0, variable:str='Temperature (°C)'):
    model_d=_dataset(model_id,'model'); argo_d=_dataset(argo_id)
    if argo_d['kind']=='observation': return _validate_tabular_profile(model_d,argo_d,profile_index,variable)
    if argo_d['kind']!='argo': raise HTTPException(400,'Validation requires Argo or CSV/ASCII observations')
    mds=xr.open_dataset(model_d['path'],decode_times=True); ads=xr.open_dataset(argo_d['path'],decode_times=True)
    try:
        alat=_coord(ads,['latitude','lat']); alon=_coord(ads,['longitude','lon']); adepth=_coord(ads,['depth','pres','pressure','lev','z']); atime=_coord(ads,['time','juld','date'])
        if not (alat and alon and adepth): raise HTTPException(400,'Argo dataset must contain latitude, longitude and depth coordinates')
        pdim=_argo_profile_dim(ads,adepth,alat)
        if profile_index<0 or profile_index>=int(ads.sizes.get(pdim,1)): raise HTTPException(400,'Invalid profile index')
        avar=_find_var(ads,variable); mvar=_find_var(mds,variable)
        if not avar: raise HTTPException(400,f'Argo variable not found for {variable}')
        if not mvar: raise HTTPException(400,f'Model variable not found for {variable}')
        adep=_profile_depth(ads,adepth,pdim,profile_index)
        obsda=ads[avar]
        if pdim in obsda.dims: obsda=obsda.isel({pdim:profile_index})
        obs=_to_num(obsda.values).ravel()
        # Keep common valid samples only.
        n=min(len(adep),len(obs)); adep=adep[:n]; obs=obs[:n]
        valid=np.isfinite(adep)&np.isfinite(obs); adep=adep[valid]; obs=obs[valid]
        lat=float(_profile_scalar(ads,alat,pdim,profile_index)); lon=float(_profile_scalar(ads,alon,pdim,profile_index))
        tm=_profile_scalar(ads,atime,pdim,profile_index) if atime else None
        mlat=_coord(mds,['latitude','lat']); mlon=_coord(mds,['longitude','lon']); mdepth=_coord(mds,['depth','lev','z']); mtime=_coord(mds,['time','date'])
        if not (mlat and mlon and mdepth): raise HTTPException(400,'Model dataset must contain latitude, longitude and depth coordinates')
        mda=mds[mvar]
        # Select nearest horizontal and temporal model cell.
        if mtime and tm is not None and mtime in mda.dims:
            try: mda=mda.sel({mtime:np.datetime64(tm)},method='nearest')
            except: mda=mda.isel({mtime:0})
        elif mtime and mtime in mda.dims: mda=mda.isel({mtime:0})
        if mlat in mda.dims: mda=mda.sel({mlat:lat},method='nearest')
        if mlon in mda.dims: mda=mda.sel({mlon:lon},method='nearest')
        # Remove any unexpected singleton dimensions.
        for dim in list(mda.dims):
            if dim!=mdepth and mda.sizes[dim]==1: mda=mda.isel({dim:0})
        if mdepth not in mda.dims: raise HTTPException(400,'Model variable does not contain a depth dimension')
        # Average remaining horizontal dimensions if needed.
        extra=[d for d in mda.dims if d!=mdepth]
        if extra: mda=mda.mean(dim=extra,skipna=True)
        md=_to_num(mds[mdepth].values).ravel(); mv=_to_num(mda.values).ravel()
        good=np.isfinite(md)&np.isfinite(mv)
        md=md[good]; mv=mv[good]
        order=np.argsort(md); md=md[order]; mv=mv[order]
        if len(md)<2: raise HTTPException(400,'Not enough valid model depth values for interpolation')
        model=np.interp(adep,md,mv,left=np.nan,right=np.nan)
        rows=[]
        for d,o,mm in zip(adep,obs,model):
            if np.isfinite(mm): rows.append({'depth':float(d),'observed':float(o),'model':float(mm),'diff':float(mm-o)})
        if not rows: raise HTTPException(400,'No overlapping depth range between model and observation')
        diff=np.array([r['diff'] for r in rows]); ob=np.array([r['observed'] for r in rows]); mo=np.array([r['model'] for r in rows])
        corr=float(np.corrcoef(ob,mo)[0,1]) if len(rows)>1 and np.std(ob)>0 and np.std(mo)>0 else 0.0
        metrics={'bias':float(np.mean(diff)),'mae':float(np.mean(np.abs(diff))),'rmse':float(np.sqrt(np.mean(diff**2))),'correlation':corr,'samples':len(rows)}
        return {'source':'real_uploaded_data','model_dataset':model_d['filename'],'argo_dataset':argo_d['filename'],'variable':variable,'profile_index':profile_index,
                'instrument':{'id':_profile_id(ads,pdim,profile_index),'type':'Argo Float','latitude':lat,'longitude':lon,'time':None if tm is None else str(tm),'max_depth':float(np.nanmax(adep)),'variables':[v['name'] for v in _meta_netcdf(argo_d['path'],'argo')['variables']]},
                'rows':rows,'metrics':metrics,
                'match':{'method':'nearest latitude/longitude/time + linear depth interpolation'}}
    finally:
        mds.close(); ads.close()

# ---- Real uploaded model field for the 3D renderer ----
@app.get('/api/datasets/{dataset_id}/field')
def uploaded_model_field(dataset_id:str, variable:str='Temperature (°C)', time_index:int=0, max_xy:int=36, max_z:int=28):
    d=_dataset(dataset_id,'model')
    ds=xr.open_dataset(d['path'],decode_times=True)
    try:
        var=_find_var(ds,variable)
        if not var: raise HTTPException(400,f'No numeric variable available for {variable}')
        da=ds[var]
        # Choose first/nearest time for rendering; the profile API performs exact matching.
        time_name=_coord(ds,['time','date'])
        times=[]
        if time_name and time_name in ds.variables:
            try: times=[str(x) for x in np.asarray(ds[time_name].values).ravel()[:120]]
            except: times=[]
        if time_name in da.dims: da=da.isel({time_name:int(np.clip(time_index,0,max(0,da.sizes[time_name]-1)))})
        depth_name=_coord(ds,['depth','lev','z','pressure'])
        lat_name=_coord(ds,['latitude','lat']); lon_name=_coord(ds,['longitude','lon'])
        # Identify rendering dimensions, then collapse unsupported extras safely.
        keep=[x for x in [depth_name,lat_name,lon_name] if x and x in da.dims]
        for dim in list(da.dims):
            if dim not in keep: da=da.isel({dim:0}) if da.sizes[dim] else da
        if not depth_name or depth_name not in da.dims:
            da=da.expand_dims({'__depth__':[0.]}); depth_name='__depth__'
        if not lat_name or lat_name not in da.dims:
            da=da.expand_dims({'__lat__':[0.]}); lat_name='__lat__'
        if not lon_name or lon_name not in da.dims:
            da=da.expand_dims({'__lon__':[0.]}); lon_name='__lon__'
        targets={depth_name:min(max_z,int(da.sizes[depth_name])),
                 lat_name:min(max_xy,int(da.sizes[lat_name])),
                 lon_name:min(max_xy,int(da.sizes[lon_name]))}
        for dim,n in targets.items():
            if da.sizes[dim]>n:
                idx=np.linspace(0,da.sizes[dim]-1,n).round().astype(int)
                da=da.isel({dim:idx})
        da=da.transpose(depth_name,lat_name,lon_name)
        a=np.asarray(da.values,dtype=np.float32)
        finite=a[np.isfinite(a)]
        if finite.size==0: raise HTTPException(400,'Selected model field contains no finite values')
        fill=float(np.nanmedian(finite)); a=np.nan_to_num(a,nan=fill,posinf=fill,neginf=fill)
        mn=float(np.nanpercentile(a,2)); mx=float(np.nanpercentile(a,98))
        if not np.isfinite(mn) or not np.isfinite(mx) or mx<=mn: mn,mx=float(a.min()),float(a.max()+1e-6)
        return {'dataset_id':dataset_id,'variable':variable,'source':'real_uploaded_model',
                'shape':{'nz':int(a.shape[0]),'ny':int(a.shape[1]),'nx':int(a.shape[2])},
                'min':mn,'max':mx,'values':a.ravel(order='C').tolist(),
                'depth':_to_num(da[depth_name].values).ravel().tolist(),
                'latitude':_to_num(da[lat_name].values).ravel().tolist(),
                'longitude':_to_num(da[lon_name].values).ravel().tolist(), 'time_index':int(time_index), 'times':times}
    finally: ds.close()
