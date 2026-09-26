FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user
RUN useradd --create-home --uid 10001 liftoff && chown -R liftoff /app
USER liftoff

EXPOSE 8000
# Note: What-If/deploy need the Azure CLI, which this slim image does not include.
# Run the backend on the host (see README) for deployments.
CMD ["sh", "-c", "uvicorn main:app --host ${HOST} --port ${PORT}"]
