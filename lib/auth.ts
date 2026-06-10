/** If DASHBOARD_PASSWORD is set, write endpoints require it in the x-dashboard-key header. */
export function authorized(req: Request): boolean {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return true;
  return req.headers.get('x-dashboard-key') === pw;
}
