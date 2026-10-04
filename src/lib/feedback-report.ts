export function feedbackReport(category:string,description:string,pagePath:string):string{
  return `# Knowledge Hub feedback\n\nCategory: ${category}\nPage: ${pagePath}\n\n## What happened\n\n${description.trim()}\n\n## Expected behavior\n\nPlease describe the result you expected.\n`;
}
