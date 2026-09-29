import type { Decision, DecisionInput } from "../decision";
import type { MirrorClient } from "../mirror";

export interface SkillContext {
  mirror: MirrorClient;
  /**
   * This skill's most recent decision, read back from the connection topic.
   * The agent's memory is its own verifiable log, not a local database.
   */
  previous: Decision | null;
}

export interface SkillOutcome {
  action: string;
  reason: string;
  input: DecisionInput;
}

/**
 * The extension point of the template. A skill perceives something and
 * decides; publishing, consensus timestamping and verification are handled
 * by `performAction`, so a skill never touches keys or topics.
 */
export interface AgentSkill {
  name: string;
  description: string;
  decide(ctx: SkillContext): Promise<SkillOutcome>;
}
