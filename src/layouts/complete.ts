import { Octokit } from "@octokit/rest";
import { escapeMarkdownTokens } from "../utils";
import { Fact, PotentialAction } from "../models";
import { formatCozyLayout } from "./cozy";
import { getInput } from "@actions/core";

export function formatFilesToDisplay(
  files: Octokit.ReposGetCommitResponseFilesItem[],
  allowedLength: number,
  htmlUrl: string
) {
  const filesChanged = files
    .slice(0, allowedLength)
    .map(
      (file: any) =>
        `[${escapeMarkdownTokens(file.filename)}](${file.blob_url}) (${
          file.changes
        } changes)`
    );

  let filesToDisplay = "";
  if (files.length === 0) {
    filesToDisplay = "*No files changed.*";
  } else {
    filesToDisplay = "* " + filesChanged.join("\n\n* ");
    if (files.length > 7) {
      const moreLen = files.length - 7;
      filesToDisplay += `\n\n* and [${moreLen} more files](${htmlUrl}) changed`;
    }
  }

  return filesToDisplay;
}

export function formatCompleteLayout(
  commit: Octokit.Response<Octokit.ReposGetCommitResponse>,
  status: string,
  elapsedSeconds?: number
) {
  const repoUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  const branchUrl = `${repoUrl}/tree/${process.env.GITHUB_REF}`;
  const webhookBody = formatCozyLayout(commit, status, elapsedSeconds);
  const section = webhookBody.sections[0];

  // for complete layout, just replace activityText with potentialAction
  section.activityText = undefined;
  section.potentialAction = [
    new PotentialAction("View build/deploy status", [
      `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    ]),
    new PotentialAction("Review commit diffs", [commit.data.html_url]),
  ];

  // Set status and elapsedSeconds
  let labels = `\`${status.toUpperCase()}\``;
  if (elapsedSeconds) {
    labels = `\`${status.toUpperCase()} [${elapsedSeconds}s]\``;
  }

  // Set section facts
  section.facts = [
    new Fact(
      "Event type:",
      "`" + process.env.GITHUB_EVENT_NAME?.toUpperCase() + "`"
    ),
    new Fact("Status:", labels),
    new Fact(
      "Commit message:",
      escapeMarkdownTokens(commit.data.commit.message)
    ),
    new Fact("Repository & branch:", `[${branchUrl}](${branchUrl})`),
  ];

  // Set environment name
  const environment = getInput("environment");
  if (environment.trim() !== "") {
    section.facts.splice(
      1,
      0,
      new Fact("Environment:", `\`${environment.toUpperCase()}\``)
    );
  }

  // Set list of files
  const includeFiles =
    getInput("include-files").trim().toLowerCase() === "true";
  if (includeFiles) {
    const allowedFileLen = getInput("allowed-file-len").toLowerCase();
    const allowedFileLenParsed = parseInt(
      allowedFileLen === "" ? "7" : allowedFileLen
    );
    const filesToDisplay = formatFilesToDisplay(
      commit.data.files,
      allowedFileLenParsed,
      commit.data.html_url
    );
    section.facts?.push({
      name: "Files changed:",
      value: filesToDisplay,
    });
  }

  return webhookBody;
}