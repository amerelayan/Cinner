from fastapi import FastAPI

app = FastAPI(title="Cinner API")


@app.get("/health")
def health_check():
    return {"status": "ok"}
