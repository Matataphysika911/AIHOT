// Industry integration contracts; no database, network or paid model calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CATEGORIES, ENTITIES, TOPIC_TAGS, ENTITY_TAGS } from "@aihot/industry/taxonomy";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { promptText } from "@aihot/backend/editorial/prompts";
import { matchEntityIds } from "@aihot/backend/editorial/writing";

test("robotics sources conform to the active collector contract without full-text grants", () => {
  const { sources } = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
  assert.equal(new Set(sources.map((s: { id: string }) => s.id)).size, sources.length);
  for (const s of sources) {
    assert.deepEqual(unsupportedConfig(s.kind, s.config), [], s.id);
    assert.equal(s.site_fulltext, false, s.id);
    assert.equal(s.syndicate_fulltext, false, s.id);
    assert.ok(["T1", "T1_5", "T2"].includes(s.tier), s.id);
    if (s.owner_entity_id) assert.ok(ENTITIES[s.owner_entity_id], s.id);
    assert.equal(new URL(s.config.feedUrl ?? s.config.url).protocol, "https:", s.id);
  }
});

test("robotics taxonomy retains public identities and understanding uses the same tag whitelist", () => {
  const keys = CATEGORIES.map((c) => c.key);
  for (const key of ["ai-models", "ai-products", "industry", "paper", "tip", "opinion", "embodied-ai", "robotics-products", "robot-ai", "edge-ai-soc", "industry-signal"]) assert.ok(keys.includes(key as typeof keys[number]));
  const prompt = promptText("understand");
  const list = (label: string) => prompt.split(`- ${label}：`)[1]!.split("\n")[0]!.split("、");
  assert.deepEqual(new Set(list("主题")), new Set(TOPIC_TAGS));
  assert.deepEqual(new Set(list("实体")), new Set(ENTITY_TAGS));
  assert.ok(!prompt.includes("{{"));
});

test("robot brand identity guards do not treat limbs, figures or scaling factors as companies", () => {
  assert.ok(!matchEntityIds(["A robot arm moves the object in figure 2 at 1x speed."]).some((id) => ["arm", "figure", "1x"].includes(id)));
  for (const [text, id] of [["Arm CPU", "arm"], ["Figure AI humanoid", "figure"], ["1X Technologies", "1x"], ["瑞芯微 RKNN", "rockchip"], ["地瓜机器人", "d-robotics"]]) assert.ok(matchEntityIds([text]).includes(id!));
});
