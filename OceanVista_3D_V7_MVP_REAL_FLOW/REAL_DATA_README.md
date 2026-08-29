# OceanVista Real Data Validation Flow

## What is now real
The right-side PROFILE, MODEL VS OBSERVATION and QUALITY tabs can use uploaded NetCDF data.

Workflow:
1. Start backend.
2. Start frontend.
3. Open Scientific Data Workspace.
4. Upload `oceanvista_demo_model.nc` under **Model NetCDF**.
5. Upload `oceanvista_demo_argo.nc` under **Argo NetCDF**.
6. Close the workspace.
7. In the right panel select an uploaded Argo profile from the new dropdown.
8. PROFILE displays observed values extracted from the uploaded Argo dataset.
9. MODEL VS OBSERVATION matches nearest model latitude/longitude/time and linearly interpolates model values to Argo depths.
10. QUALITY calculates Bias, MAE, RMSE and Correlation from those matched values.

## Backend restart note
Uploaded dataset IDs are held in memory. After restarting the backend, upload the files again.

## Supported matching
- nearest latitude
- nearest longitude
- nearest time
- linear interpolation in depth

## Demo files included
- oceanvista_demo_model.nc
- oceanvista_demo_argo.nc
- oceanvista_demo_observations.csv
