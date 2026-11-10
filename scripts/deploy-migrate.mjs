// Runs before `next build` on Vercel. Production deployments apply pending migrations first, so the
// new code never goes live on an old schema; if a migration fails, the build fails and the previous
// deployment keeps serving. Preview and local builds never touch the database.
if (process.env.VERCEL_ENV === 'production' && process.env.DATABASE_URL) {
  await import('./migrate.mjs');
} else {
  console.log('Migrations skipped (not a production deployment).');
}
