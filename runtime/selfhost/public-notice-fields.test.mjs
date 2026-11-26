import assert from "node:assert/strict";
import test from "node:test";
import { extractNoticeEvidence } from "./noticeEvidence.mjs";
import { inferNoticeFields } from "./custom-source-evidence.mjs";

const samples = [
  {
    source:"https://sbc.yctu.edu.cn/2026/1103/c872a157169/page.htm",
    body:"预算金额：60万元（服务期2年）。最高限价：30万元/年。",
    expected:{ procurementBudget:"60万元", budget:"30万元/年" },
  },
  {
    source:"https://www.dongtai.gov.cn/art/2026/11/24/art_7905_4470550.html",
    body:"最高限价：21.25989万元。投标截止时间和开标时间为2026年12月8日9时00分。",
    expected:{ budget:"21.25989万元",deadline:"2026年12月8日9时00分",openTime:"2026年12月8日9时00分" },
  },
  {
    source:"https://www.yandu.gov.cn/art/2026/11/19/art_23720_4469430.html",
    body:"递交截止时间当日,建筑业企业资质动态监管结果均不处于不合格状态。投标截止时间前失信被执行人信息已撤销或更正的除外。",
    expected:{deadline:null},
  },
];

test("官方样本保留年度单价、同步开标及截止时间的范围",()=>{
  for (const { source,body,expected } of samples) {
    const evidence=extractNoticeEvidence({body,url:source});
    for (const [key,value] of Object.entries(expected)) {
      const entries=evidence.fields[key].entries;
      assert.equal(entries[0]?.value ?? null,value,source);
      if (value) {
        assert.equal(entries[0].url,source);
        assert.ok(entries[0].paragraph>0);
      }
    }
  }
  assert.equal(inferNoticeFields("",samples[1].body,"tender").deadlineText,"2026-12-08 09:00");
});
