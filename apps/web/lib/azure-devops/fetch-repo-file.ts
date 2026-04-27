import "server-only";

export async function fetchAdoRepoFile(args: {
  org: string;
  project: string;
  repo: string;
  branch: string;
  path: string;
  pat: string;
}): Promise<string | null> {
  const params = new URLSearchParams({
    path: args.path,
    "versionDescriptor.version": args.branch,
    "versionDescriptor.versionType": "branch",
    "api-version": "7.1",
  });

  const url = `https://dev.azure.com/${encodeURIComponent(args.org)}/${encodeURIComponent(args.project)}/_apis/git/repositories/${encodeURIComponent(args.repo)}/items?${params.toString()}`;

  const auth = Buffer.from(`:${args.pat}`).toString("base64");

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "text/plain",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Azure DevOps fetchRepoFile failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}
