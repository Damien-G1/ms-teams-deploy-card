import { components } from '@octokit/openapi-types';
import { getInput, info, warning } from '@actions/core';
import yaml from 'yaml';
import { CustomFact } from 'types';
import { escapeMarkdownTokens, getRunInformation, renderActions } from '../utils';
import { Fact, ChangelogItem } from '../models';
import { formatCozyLayout } from './cozy';

export const formatChangelogLayout = (
  commit: components["schemas"]["commit"],
  conclusion: string,
  elapsedSeconds?: number,
  commits?: components["schemas"]["commit"][],
) => {
  // const { branch, branchUrl, repoUrl } = getRunInformation();
  const webhookBody = formatCozyLayout(commit, conclusion, elapsedSeconds);
  const [ section ] = webhookBody.sections;

  // Remove activityText
  section.activityText = undefined;

  // Set section facts
  section.facts = [];

  section.changelog = [];

  // Set changelog
  for (const c of commits) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    // const escapedMessage = escapeMarkdownTokens(c.commit.message);
    const commitMessage = c.commit.message;
    const [ title, ...messageLines ] = commitMessage.split(`\n\n`);
    const message = messageLines.join(`\n\n`) || ``;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const commitShort = c.sha.substring(0, 7) as string;
    section.changelog.push(new ChangelogItem(title, commitShort, message));
  }

  return webhookBody;
};
