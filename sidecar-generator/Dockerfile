FROM python:3.12-slim

# ffprobe (part of ffmpeg) is required to read real video durations; the generator
# itself has no other dependencies (stdlib only).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY generate_chapters.py .

ENTRYPOINT ["python3", "generate_chapters.py"]
CMD ["--help"]
