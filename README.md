# Fiscus

Simple starter project for nonprofit financial information onboarding.

## Backend (Flask)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Backend runs on `http://localhost:5000`.

## Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api/*` to the Flask backend.

## Available API endpoints

- `GET /api/health`
- `GET /api/onboarding-overview`
