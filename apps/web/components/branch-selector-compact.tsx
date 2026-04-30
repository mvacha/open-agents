"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { CheckIcon, ChevronDown, GitBranch, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/swr";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type BranchSelectorSource =
  | { provider: "github"; owner: string; repo: string }
  | { provider: "azure_devops"; projectId: string; repo: string };

interface BranchSelectorCompactProps {
  source: BranchSelectorSource;
  value: string | null;
  isNewBranch: boolean;
  onChange: (branch: string | null, isNewBranch: boolean) => void;
}

interface BranchesResponse {
  branches: string[];
  defaultBranch: string;
}

function buildBranchesUrl(source: BranchSelectorSource, query: string): string {
  if (source.provider === "github") {
    const params = new URLSearchParams({
      owner: source.owner,
      repo: source.repo,
      limit: "50",
    });
    if (query) params.set("query", query);
    return `/api/github/branches?${params.toString()}`;
  }
  const params = new URLSearchParams({ limit: "50" });
  if (query) params.set("query", query);
  return `/api/azure-devops/projects/${encodeURIComponent(
    source.projectId,
  )}/repos/${encodeURIComponent(source.repo)}/branches?${params.toString()}`;
}

function sourceKey(source: BranchSelectorSource): string {
  return source.provider === "github"
    ? `gh:${source.owner}/${source.repo}`
    : `ado:${source.projectId}/${source.repo}`;
}

export function BranchSelectorCompact({
  source,
  value,
  isNewBranch,
  onChange,
}: BranchSelectorCompactProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());

  const autoSelectedKeyRef = useRef<string | null>(null);

  const branchesUrl = buildBranchesUrl(source, deferredSearchQuery);

  const { data, isLoading, isValidating } = useSWR<BranchesResponse>(
    branchesUrl,
    fetcher,
  );

  const branches = data?.branches ?? [];
  const defaultBranch = data?.defaultBranch ?? "main";
  const isBranchLoading = isLoading || isValidating;

  const key = sourceKey(source);

  useEffect(() => {
    if (data && !value && !isNewBranch && autoSelectedKeyRef.current !== key) {
      autoSelectedKeyRef.current = key;
      onChange(null, true);
    }
  }, [data, value, isNewBranch, onChange, key]);

  useEffect(() => {
    setSearchQuery("");
  }, [key]);

  const handleSelectBranch = (branch: string) => {
    onChange(branch, false);
    setSearchQuery("");
    setOpen(false);
  };

  const handleSelectNewBranch = () => {
    onChange(null, true);
    setSearchQuery("");
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
    }
  };

  const getDisplayText = () => {
    if (isBranchLoading) return "Loading...";
    if (isNewBranch) return "New branch (auto)";
    return value || defaultBranch || "main";
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={true}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-input bg-background/80 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400 dark:hover:border-white/20 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300"
        >
          <GitBranch className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">{getDisplayText()}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search branches..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>
              {isBranchLoading
                ? "Loading..."
                : deferredSearchQuery
                  ? "No matching branches found."
                  : "No branches found."}
            </CommandEmpty>
            <CommandGroup>
              {branches.map((branch) => (
                <CommandItem
                  key={branch}
                  value={branch}
                  onSelect={() => handleSelectBranch(branch)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      value === branch && !isNewBranch
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  <span className="truncate">{branch}</span>
                  {branch === defaultBranch && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      default
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={handleSelectNewBranch}>
                <CheckIcon
                  className={cn(
                    "mr-2 size-4",
                    isNewBranch ? "opacity-100" : "opacity-0",
                  )}
                />
                <PlusIcon className="mr-2 size-4" />
                New branch (auto-generated)
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
