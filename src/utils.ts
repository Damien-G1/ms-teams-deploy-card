import { components } from '@octokit/openapi-types';
import { error, getInput, info, setFailed, setOutput, warning } from '@actions/core';
import fetch, { Response } from 'node-fetch';
import moment from 'moment';
import yaml from 'yaml';
import { octokit } from 'octokit';
import Jimp from 'jimp';
import { PotentialAction, WebhookBody } from './models';
import { formatCompactLayout } from './layouts/compact';
import { formatCozyLayout } from './layouts/cozy';
import { formatCompleteLayout } from './layouts/complete';
import { CustomAction, WorkflowRunStatus } from './types';

export const escapeMarkdownTokens = (text: string) => text
  .replace(/\n {1,}/g, `\n `)
  .replace(/_/g, `\\_`)
  .replace(/\*/g, `\\*`)
  .replace(/\|/g, `\\|`)
  .replace(/#/g, `\\#`)
  .replace(/-/g, `\\-`)
  .replace(/>/g, `\\>`);

export const getRunInformation = () => {
  const [ owner, repo ] = (process.env.GITHUB_REPOSITORY || ``).split(`/`);
  const branch = process.env.GITHUB_REF?.replace(`refs/heads/`, ``);
  const repoUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`;
  return {
    branch,
    branchUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/tree/${branch}`,
    owner,
    ref: process.env.GITHUB_SHA || undefined,
    repo,
    repoUrl,
    runId: process.env.GITHUB_RUN_ID || undefined,
    runLink: `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    runNum: process.env.GITHUB_RUN_NUMBER || undefined,
    shortSha: process.env.GITHUB_SHA?.substr(0, 7),
  };
};

export const getOctokitCommit = () => {
  const runInfo = getRunInformation();
  info(`Workflow run information: ${JSON.stringify(runInfo, undefined, 2)}`);

  return octokit.rest.repos.getCommit({
    owner: runInfo.owner,
    ref: runInfo.ref || ``,
    repo: runInfo.repo,
  });
};

export const submitNotification = async (webhookBody: WebhookBody) => {
  const webhookUri = getInput(`webhook-uri`, { required: true });
  // const webhookBodyJson = JSON.stringify(webhookBody, undefined, 2);
  const {
    sections,
    text,
    themeColor,
  } = webhookBody;

  // Use Jimp to create a 3x3 image with the themeColor
  const image = new Jimp(3, 3, themeColor);
  // Convert the image to a base64 string
  const themeColorBase64 = await image.getBase64Async(Jimp.MIME_PNG);

  const webhookBodyJson = JSON.stringify({
    attachments: [{
      content: {
        actions: sections.reduce((acc, section) => {
          if (section.potentialAction) {
            return [
              ...acc,
              ...section.potentialAction.map((action) => ({
                title: action.name,
                type: `Action.OpenUrl`,
                url: action.target[0],
              })),
            ];
          }
          return acc;
        }, [] as Array<{ title: string, type: string, url: string }>),
        backgroundImage: {
          fillMode: `RepeatHorizontally`,
          url: themeColorBase64,
        },
        body: [
          ...text ? [
            {
              size: `Medium`,
              text,
              type: `TextBlock`,
              weight: `Bolder`,
              wrap: true,
            },
          ] : [],
          ...sections.map((section) => ({
            items: [
              {
                columns: [
                  {
                    items: [
                      {
                        size: `Medium`,
                        style: `Default`,
                        type: `Image`,
                        url: section.activityImage,
                        // style: `Person`,
                      },
                    ],
                    type: `Column`,
                    width: `auto`,
                  },
                  {
                    items: [
                      {
                        height: `stretch`,
                        maxLines: 2,
                        spacing: `None`,
                        text: section.activityTitle,
                        type: `TextBlock`,
                        wrap: true,
                      },
                      {
                        isSubtle: true,
                        spacing: `None`,
                        text: section.activitySubtitle,
                        type: `TextBlock`,
                        wrap: true,
                      },
                      // activityText
                      section.activityText && {
                        spacing: `None`,
                        text: section.activityText,
                        type: `TextBlock`,
                        wrap: true,
                      },
                    ],
                    type: `Column`,
                    width: `stretch`,
                  },
                ],
                type: `ColumnSet`,
              },
              section.facts && section.facts.length > 0 && {
                facts: section.facts.map((fact) => ({
                  title: fact.name,
                  type: `Fact`,
                  value: fact.value,
                })),
                type: `FactSet`,
              },
            ],
            type: `Container`,
          })),
        ],
        msteams: {
          width: `full`,
        },
        schema: `http://adaptivecards.io/schemas/adaptive-card.json`,
        type: `AdaptiveCard`,
        version: `1.4`,
      },
      contentType: `application/vnd.microsoft.card.adaptive`,
    }],
    type: `message`,
  }, undefined, 2);

  return fetch(webhookUri, {
    body: webhookBodyJson,
    headers: {
      "Content-Type": `application/json`,
    },
    method: `POST`,
  })
    .then((response: Response) => {
      setOutput(`webhook-body`, webhookBodyJson);
      info(webhookBodyJson);
      return response;
    })
    .catch(error);
};

export const formatAndNotify = async (
  state: "start" | "exit",
  conclusion = `in_progress`,
  elapsedSeconds?: number,
) => {
  let webhookBody: WebhookBody;
  const { data: commit } = await getOctokitCommit();
  const cardLayout = getInput(`card-layout-${state}`);

  switch (cardLayout) {
    case `compact`:
      webhookBody = formatCompactLayout(commit, conclusion, elapsedSeconds);
      break;
    case `cozy`:
      webhookBody = formatCozyLayout(commit, conclusion, elapsedSeconds);
      break;
    case `complete`:
      webhookBody = formatCompleteLayout(commit, conclusion, elapsedSeconds);
      break;
    default:
      setFailed(`Invalid card layout: ${cardLayout}`);
      break;
  }

  await submitNotification(webhookBody);
};

export const getWorkflowRunStatus = async (): Promise<WorkflowRunStatus> => {
  const runInfo = getRunInformation();

  const workflowJobs = await octokit.rest.actions.listJobsForWorkflowRun({
    owner: runInfo.owner,
    repo: runInfo.repo,
    run_id: parseInt(runInfo.runId || `1`),
  });

  const job = workflowJobs.data.jobs.find((j) => j.name === process.env.GITHUB_JOB);

  let lastStep: components["schemas"]["job"]["steps"][0];
  const stoppedStep = job?.steps.find((step) =>
    step.conclusion === `failure` ||
      step.conclusion === `timed_out` ||
      step.conclusion === `cancelled` ||
      step.conclusion === `action_required`);

  if (stoppedStep) {
    lastStep = stoppedStep;
  } else {
    lastStep = job?.steps
      .reverse()
      .find((step) => step.status === `completed` && step.conclusion !== `skipped`);
  }

  const startTime = moment(job?.started_at, moment.ISO_8601);
  const endTime = moment(lastStep?.completed_at, moment.ISO_8601);

  return {
    conclusion: lastStep?.conclusion,
    elapsedSeconds: endTime.diff(startTime, `seconds`),
  };
};

export const renderActions = (statusUrl: string, diffUrl: string) => {
  const actions: PotentialAction[] = [];
  if (getInput(`enable-view-status-action`).toLowerCase() === `true`) {
    actions.push(
      new PotentialAction(getInput(`view-status-action-text`), [ statusUrl ]),
    );
  }
  if (getInput(`enable-review-diffs-action`).toLowerCase() === `true`) {
    actions.push(
      new PotentialAction(getInput(`review-diffs-action-text`), [ diffUrl ]),
    );
  }

  // Set custom actions
  const customActions = getInput(`custom-actions`);
  if (customActions && customActions.toLowerCase() !== `null`) {
    try {
      let customActionsCounter = 0;
      const customActionsList = yaml.parse(customActions) as CustomAction[];
      if (Array.isArray(customActionsList)) {
        customActionsList.forEach((action) => {
          if (
            action.text !== undefined &&
            action.url !== undefined &&
            action.url.match(/https?:\/\/\S+/g)
          ) {
            actions.push(new PotentialAction(action.text, [ action.url ]));
            customActionsCounter += 1;
          }
        });
      }
      info(`Added ${customActionsCounter} custom facts.`);
    } catch {
      warning(`Invalid custom-actions value.`);
    }
  }
  return actions;
};
