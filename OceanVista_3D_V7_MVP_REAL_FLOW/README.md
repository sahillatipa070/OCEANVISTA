# OceanVista 3D V7 — Scientific Operations

Production-oriented React + TypeScript upgrade of OceanVista V6.

## Run

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## MVP data workflow added
This version keeps the existing OceanVista UI and adds real upload/validation endpoints:
- POST /api/datasets/upload/model
- POST /api/datasets/upload/argo
- POST /api/datasets/upload/observation
- GET /api/datasets
- GET /api/datasets/{dataset_id}/metadata
- DELETE /api/datasets/{dataset_id}

The backend reads uploaded files with xarray/pandas, detects coordinates, extracts dimensions and variables, checks missing values, and returns validation errors instead of crashing.
