import { describe,it,expect } from "vitest";
import { careGuidance,mealWarning,trainingGains } from "./guidance";

describe("companion guidance matches on-chain thresholds",()=>{
  it("accounts for Care costs before recommending recovery",()=>{
    expect(careGuidance({energy:50,fullness:57,condition:12}).recommended).toBe("rest");
    expect(careGuidance({energy:71,fullness:57,condition:12}).recommended).toBe("rest");
    expect(careGuidance({energy:72,fullness:21,condition:12}).recommended).toBe("care");
    expect(careGuidance({energy:72,fullness:20,condition:12}).recommended).toBe("feed");
    expect(careGuidance({energy:72,fullness:92,condition:4}).recommended).toBe(null);
    expect(careGuidance({energy:72,fullness:91,condition:4}).recommended).toBe("care");
  });
  it("distinguishes reduced and zero training gains",()=>{
    expect(careGuidance({energy:50,fullness:50,condition:4}).tier).toBe(1);
    expect(careGuidance({energy:49,fullness:50,condition:4}).tier).toBe(0);
    expect(careGuidance({energy:19,fullness:50,condition:0}).tier).toBe(0);
    expect(trainingGains(1,[4,0,0,1])).toBe("HP +2 · SPD +1");
    expect(trainingGains(0,[4,0,0,1])).toBe("No stat gains");
  });
  it("predicts each meal separately and warns about repeated overfeeding",()=>{
    const state={energy:50,fullness:75,condition:0};
    expect(mealWarning(state,0)).toContain("overfeed");
    expect(mealWarning(state,3)).toBe("");
    expect(mealWarning({...state,fullness:90},3)).toContain("care mistake");
    expect(mealWarning({...state,condition:2},3)).toContain("sickness");
  });
});
