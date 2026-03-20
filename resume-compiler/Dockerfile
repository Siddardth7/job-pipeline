FROM python:3.11-slim

# Install fontconfig + Carlito font (needed by XeLaTeX/fontspec)
# No TeX Live needed — Tectonic replaces it entirely
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
      libfontconfig1 \
      fontconfig \
      fonts-crosextra-carlito && \
    fc-cache -f -v && \
    rm -rf /var/lib/apt/lists/*

# Install Tectonic — XeLaTeX-compatible engine, single binary, no format-building step
# Downloads LaTeX packages on-demand; we pre-cache them in the warmup step below
RUN ARCH=$(uname -m) && \
    VERSION="0.14.1" && \
    curl -fsSL \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/tectonic-${VERSION}-${ARCH}-unknown-linux-musl.tar.gz" | \
    tar xz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/tectonic && \
    tectonic --version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-warm Tectonic: compile the warmup document to download and cache
# all LaTeX packages used by the resume templates (~100MB download, baked into image).
# Runtime compilations use this cache — no internet access needed.
RUN tectonic --outdir /tmp warmup/warmup.tex && \
    rm -f /tmp/warmup.pdf

EXPOSE 8080

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8080", "--timeout", "60", "app:app"]
