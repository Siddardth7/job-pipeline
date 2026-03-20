// Scheduled function — runs every 10 minutes to prevent Railway cold starts.
// Schedule is defined in netlify.toml.
export default async () => {
  const url = process.env.VITE_COMPILER_URL ?? "https://resume-compiler-production.up.railway.app";
  const res = await fetch(`${url}/health`);
  console.log(`keep-alive: ${res.status} from ${url}`);
};
