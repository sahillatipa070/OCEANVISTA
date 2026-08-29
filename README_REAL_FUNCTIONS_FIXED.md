OceanVista V7 REAL DATA + INTERACTION FIX

Changes:
- Model NetCDF field reloads by selected variable and timeline time index.
- Returned model times populate timeline when available.
- Uploaded CSV/TXT/ASCII observations are stored in the dashboard state and can drive profile validation against the uploaded model.
- Chlorophyll layer selects the chlorophyll scientific variable when enabled.
- Color min/max remaps the real 3D field and invalid min>=max edits are rejected.
- Bathymetry geometry rebuilt safely.
- Isosurface rebuilt from a stable indexed scientific surface to avoid blank-screen crashes.
- Animated water, glider, currents, smooth camera damping, richer volumetric fallback.

Run backend:
py -m pip install -r requirements.txt
py -m uvicorn main:app --reload --port 8000

Run frontend:
npm install
npm run dev

Real-data workflow:
1. Upload Model NetCDF.
2. Upload Argo NetCDF OR CSV/ASCII observation data.
3. Choose a scientific variable present in both datasets.
4. Select a profile in the right panel.
5. Use the timeline to load model time steps.
