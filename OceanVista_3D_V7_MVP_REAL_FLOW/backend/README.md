# OceanVista V6 Backend

Real-data API for NOAA ERDDAP, Argovis, Marine Regions and GEBCO, plus local NetCDF upload.

Run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```
