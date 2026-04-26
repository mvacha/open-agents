// Matches forward slash, backslash, carriage return, newline, and tab
const FORBIDDEN_CHAR_PATTERN = /[/\\\r\n\t]/;

export function isValidAdoIdentifier(value: string): boolean {
  if (!value || value.length === 0) {
    return false;
  }
  return !FORBIDDEN_CHAR_PATTERN.test(value);
}

export function buildAdoAuthRemoteUrl(params: {
  token: string;
  org: string;
  project: string;
  repo: string;
}): string | null {
  const { token, org, project, repo } = params;
  if (
    !isValidAdoIdentifier(org) ||
    !isValidAdoIdentifier(project) ||
    !isValidAdoIdentifier(repo)
  ) {
    return null;
  }
  return `https://anything:${encodeURIComponent(token)}@dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`;
}

export function buildAdoRepoWebUrl(params: {
  org: string;
  project: string;
  repo: string;
}): string {
  const { org, project, repo } = params;
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`;
}

export function buildAdoPullRequestUrl(
  ref: { org: string; project: string; repo: string },
  prNumber: number,
): string {
  return `${buildAdoRepoWebUrl(ref)}/pullrequest/${prNumber}`;
}
