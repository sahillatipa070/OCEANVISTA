OceanVista V7 Functional Stability + Real Field Update

Fixes:
- Isosurface mode is isolated and guarded by a scene error boundary.
- Bathymetry uses safe geometry and cannot remove the whole Canvas.
- Uploaded Model NetCDF now has a /field API used by the 3D renderer.
- Real uploaded model values are rendered as a depth/latitude/longitude point volume.
- Model/Argo profile matching remains real-data based.
- PROFILE, MODEL VS OBSERVATION and QUALITY tabs are functional.
- Toolbar screenshot, share state, measurement, settings and help are functional.
- Smooth wave, glider/current motion and UI transitions added.

Run backend:
py -m pip install -r requirements.txt
py -m uvicorn main:app --reload --port 8000

Run frontend:
npm install
npm run dev

Upload model and Argo datasets again after backend restart.
