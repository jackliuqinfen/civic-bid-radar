import { inferNoticeFields } from "./custom-source-evidence.mjs";

const changeVerb = "(?:现)?(?:调整为|更正为|变更为|修改为|延期至|延长至|提前至|推迟至|改为)";
const qualifiedTime = "(?:投标|响应)(?:文件)?(?:递交|提交)?截止(?:时间|日期)?(?:和开标时间)?";
const directChange = new RegExp(qualifiedTime+"[：:\\s]*"+changeVerb+"[：:\\s]*(20\\d{2}[^。；;\\n]{5,40})","g");

export function currentDeadline(original, changes) {
  let value=String(original || "0"), pending=false;
  let appliedAt="", appliedValue="";
  for (const change of changes) {
    if (change.state==="uncached" || !change.body?.trim()) { pending=true; continue; }
    const body=change.body.normalize("NFKC");
    const direct = [...body.matchAll(directChange)].map(hit=>inferNoticeFields("", "投标截止时间："+hit[1],"amendment").deadline);
    const values=new Set(direct.filter(t=>t!=="0"));
    if (values.size===1 && !direct.includes("0")) {
      const next=[...values][0];
      if (change.at===appliedAt && (appliedValue!==next || pending)) { pending=true; continue; }
      value=next;pending=false;appliedAt=change.at;appliedValue=next;
    } else {
      const field=inferNoticeFields("",body,"amendment");
      const mentions=/截止|递交时间|开标时间/.test(body);
      if (values.size>1 || field.deadlineStatus==="conflict" || (mentions && (field.deadline==="0" || field.deadline!==value))) pending=true;
    }
  }
  return pending ? "0" : value;
}
