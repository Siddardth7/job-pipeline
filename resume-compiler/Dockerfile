FROM python:3.11-slim

# Install XeLaTeX (required for fontspec/Carlito font) + Carlito font package
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      texlive-xetex \
      texlive-fonts-recommended \
      texlive-latex-extra \
      texlive-fonts-extra \
      fonts-crosextra-carlito && \
    fc-cache -f -v && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Verify xelatex is available at build time
RUN xelatex --version

EXPOSE 8080

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8080", "--timeout", "60", "app:app"]
