import { Fact, PotentialAction, ChangelogItem } from '.';

export class CardSection {
  public activityTitle = ``;
  public activitySubtitle?: string = ``;
  public activityImage = ``;
  public activityText?: string;
  public facts?: Fact[];
  public potentialAction?: PotentialAction[];
  public changelog?: ChangelogItem[];
}
