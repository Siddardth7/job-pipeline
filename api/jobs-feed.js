import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  try {
    const filePath = join(process.cwd(), 'output', 'jobs_clean_latest.json');
    const data = readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(data);
  } catch (e) {
    res.status(404).json({ error: 'Feed not found. Pipeline may not have run yet.' });
  }
}
