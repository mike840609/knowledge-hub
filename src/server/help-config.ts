/** The guide follows the deployment's Task Search reader; default-off is the product default. */
export function helpTaskSearchEnabled(): boolean {
  return process.env.TASK_SEARCH_READ_ENABLED === "true";
}
