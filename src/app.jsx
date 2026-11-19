const { useState, useRef, useEffect, useMemo, useCallback } = React;
const L = LucideReact;


/* =====================================================================
   0) LOCAL STORAGE + CLAUDE API (standalone app)
   ===================================================================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} },
};
const REPO = "hima91512-lab/parts-wizard";
const blobToB64 = (b) => new Promise((res)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]); r.readAsDataURL(b); });
function makeSample(key) {
  if (!key) return null;
  const fn = async (prompt, opts={}) => {
    const content = [];
    for (const b of (opts.images||[])) content.push({ type:"image", source:{ type:"base64", media_type:b.type||"image/jpeg", data: await blobToB64(b) } });
    content.push({ type:"text", text: prompt });
    const model = opts.images ? "claude-haiku-5-5" : "claude-sonnet-5-5";
    const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST",
      headers:{ "x-api-key":key, "anthropic-version":"2023-06-01", "content-type":"application/json", "anthropic-dangerous-direct-browser-access":"true" },
      body: JSON.stringify({ model, max_tokens: 3000, messages:[{ role:"user", content }] }) });
    if (!r.ok) { const t = await r.text(); const e = new Error(t); e.code = r.status===429 ? "rate_limited" : r.status===401 ? "bad_key" : "api_"+r.status; throw e; }
    const j = await r.json();
    return { text: (j.content||[]).map(c=>c.text||"").join("") };
  };
  fn.limits = async () => ({ images: true });
  return fn;
}

/* =====================================================================
   1) BRAND REGISTRY — part-number formats, label text, domains, links
   ===================================================================== */
const g = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q);
const BRANDS = [
  { id:"cat", name:"Caterpillar (CAT)", oem:true, dom:/(^|\.)cat\.com$|caterpillar/i,
    txt:/\bCAT\b|CATERP|PEORIA|D\d{2}M\d{2}Y\d{2}/,
    pn:[/\b(\d{3})-(\d{4})\b/g, /\b(\d[A-Z])-?(\d{4})\b/g],
    fmt:(m)=>m[1]+"-"+m[2],
    links:(p)=>[{t:"صفحة القطعة في parts.cat.com", u:"https://parts.cat.com/en/catcorp/product/"+p},
                {t:"Cat Filters Cross Reference", u:"https://www.catfiltercrossreference.com"}] },
  { id:"komatsu", name:"Komatsu", oem:true, dom:/komatsu/i, txt:/K[O0]MA[T1I]\s?[S5]U/,
    pn:[/\b([0-9A-Z]{3})-([0-9A-Z]{2,3})-([0-9A-Z]{4,5})\b/g, /\b(0\d{4})-(\d{5})\b/g],
    fmt:(m)=>m.slice(1).filter(Boolean).join("-"),
    links:(p)=>[{t:"صفحة الفلتر في komatsu.com", u:"https://www.komatsu.com/en-us/products/parts/filters/"+p}] },
  { id:"cummins", weak:true, name:"Cummins", oem:true, dom:/cummins/i, txt:/CUMMINS/, pn:[/\b(\d{7})\b/g], fmt:(m)=>m[1],
    links:()=>[{t:"التحقق من أصالة Cummins", u:"https://www.cummins.com/genuinepartsauthentication"}] },
  { id:"fleetguard", name:"Fleetguard", oem:false, dom:/fleetguard|cumminsfiltration/i, txt:/FLEETGUARD/,
    pn:[/\b((?:LF|FF|FS|AF|HF|WF|CS|CV|UF)\d{3,5}[A-Z]{0,3})\b/g], fmt:(m)=>m[1],
    links:()=>[{t:"موقع Fleetguard", u:"https://www.fleetguard.com"}] },
  { id:"donaldson", name:"Donaldson", oem:false, dom:/donaldson/i, txt:/DONALDSON/,
    pn:[/\b(P\d{6})\b/g, /\b(DB[ALF]\d{4,5})\b/g], fmt:(m)=>m[1],
    links:()=>[{t:"Donaldson Cross Reference", u:"https://crossreference.donaldson.com"}] },
  { id:"baldwin", weak:true, name:"Baldwin", oem:false, dom:/baldwin/i, txt:/BALDWIN/,
    pn:[/\b((?:BF|BT|PA|PF|PT|RS|BD|BW|LL|PT)\d{2,5}(?:-[A-Z]{2,3})?)\b/g, /\b(B\d{2,4})\b/g], fmt:(m)=>m[1],
    links:()=>[{t:"موقع Baldwin", u:"https://www.baldwinfilters.com"}] },
  { id:"hifi", name:"HIFI FILTER", oem:false, dom:/hifi-filter/i, txt:/HIFI|HI-FI/,
    pn:[/\b((?:SH|SN|SO|SA|SC|SK|BE)\s?\d{4,6})\b/g], fmt:(m)=>m[1].replace(/\s/,""),
    links:()=>[{t:"موقع HIFI", u:"https://www.hifi-filter.com"}] },
  { id:"sakura", weak:true, name:"Sakura", oem:false, dom:/sakura/i, txt:/SAKURA/,
    pn:[/\b((?:FC|EF|SFC|O|A|C|H|HC|TC|WC|F)-?\d{4,5}[A-Z]?)\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"mann", weak:true, name:"MANN-FILTER", oem:false, dom:/mann-filter|mann-hummel/i, txt:/MANN/,
    pn:[/\b((?:WK|W|C|CF|HU|CU|PU|WDK)\s?\d{3,5}(?:\/\d)?[A-Z]?)\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"wix", weak:true, name:"WIX", oem:false, dom:/wixfilters/i, txt:/\bWIX\b/, pn:[/\b(\d{5}|WA\d{5})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"volvo", weak:true, name:"Volvo CE", oem:true, dom:/volvo/i, txt:/VOLVO/, pn:[/\b(VOE\s?\d{8}|\d{8})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"perkins", weak:true, name:"Perkins", oem:true, dom:/perkins/i, txt:/PERKINS/, pn:[/\b([A-Z]{2,4}\d{3,6})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"hitachi", weak:true, name:"Hitachi", oem:true, dom:/hitachi/i, txt:/HITACHI/, pn:[/\b(\d{7})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"jcb", weak:true, name:"JCB", oem:true, dom:/jcb/i, txt:/\bJCB\b/, pn:[/\b(\d{3}\/[A-Z0-9]{4,6})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"doosan", weak:true, name:"Doosan / Develon", oem:true, dom:/doosan|develon/i, txt:/DOOSAN|DEVELON/, pn:[/\b(\d{2,3}\.\d{5}-\d{4})\b/g, /\b(4\d{7})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"wabco", weak:true, name:"WABCO (ZF)", oem:true, dom:/wabco|zf\.com/i, txt:/WABCO/, pn:[/\b(\d{3}\s?\d{3}\s?\d{3}\s?\d)\b/g], fmt:(m)=>m[1].replace(/\s/g,""),
    links:()=>[{t:"التحقق من أصالة WABCO", u:"https://www.wabco-auto.com/WABCOoriginal"}] },
  { id:"knorr", weak:true, name:"Knorr-Bremse", oem:true, dom:/knorr/i, txt:/KNORR/, pn:[/\b([A-Z]{1,3}\d{5,6}[A-Z]?)\b/g, /\b(II\d{5})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"bosch", weak:true, name:"Bosch", oem:false, dom:/bosch/i, txt:/BOSCH/, pn:[/\b(\d\s?\d{3}\s?\d{3}\s?\d{3})\b/g], fmt:(m)=>m[1].replace(/\s/g,""), links:()=>[] },
  { id:"zf", weak:true, name:"ZF", oem:true, dom:/zf\.com/i, txt:/\bZF\b/, pn:[/\b(\d{4}\s?\d{3}\s?\d{3})\b/g], fmt:(m)=>m[1].replace(/\s/g,""), links:()=>[] },
  { id:"mercedes", weak:true, name:"Mercedes-Benz", oem:true, dom:/mercedes|daimler/i, txt:/MERCEDES|DAIMLER/, pn:[/\b(A\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2})\b/g], fmt:(m)=>m[1].replace(/\s/g,""), links:()=>[] },
  { id:"man", weak:true, name:"MAN", oem:true, dom:/man-es|mantruck/i, txt:/\bMAN\b/, pn:[/\b(\d{2}\.\d{5}-\d{4})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"scania", weak:true, name:"Scania", oem:true, dom:/scania/i, txt:/SCANIA/, pn:[/\b(\d{7})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"daf", weak:true, name:"DAF / PACCAR", oem:true, dom:/daf|paccar/i, txt:/\bDAF\b|PACCAR/, pn:[/\b(\d{7})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"isuzu", weak:true, name:"Isuzu", oem:true, dom:/isuzu/i, txt:/ISUZU/, pn:[/\b([18]-?\d{5}-?\d{3}-?\d)\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"mitsubishi", weak:true, name:"Mitsubishi Fuso", oem:true, dom:/mitsubishi|fuso/i, txt:/MITSUBISHI|FUSO/, pn:[/\b(M[EKH]\d{6})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"toyota", weak:true, name:"Toyota", oem:true, dom:/toyota/i, txt:/TOYOTA/, pn:[/\b(\d{5}-[0-9A-Z]{5})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"deere", weak:true, name:"John Deere", oem:true, dom:/deere/i, txt:/DEERE/, pn:[/\b((?:RE|AT|AH|AR|AL|DZ|SJ)\d{5,6})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"kubota", weak:true, name:"Kubota", oem:true, dom:/kubota/i, txt:/KUBOTA/, pn:[/\b([0-9A-Z]{5}-\d{5})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"hyundai", weak:true, name:"Hyundai CE", oem:true, dom:/hyundai/i, txt:/HYUNDAI/, pn:[/\b(\d{2}[A-Z]\d-\d{5})\b/g, /\b(\d{2}[A-Z]{2}\d{5})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"skf", weak:true, name:"SKF", oem:false, dom:/skf/i, txt:/\bSKF\b/, pn:[/\b(\d{4,6}[-\s]?(?:2RS|2Z|ZZ|C3|E)?[A-Z0-9/]*)\b/g], fmt:(m)=>m[1], links:()=>[{t:"التحقق من أصالة SKF", u:"https://www.skf.com/group/products/bearings-units-housings/genuine"}] },
  { id:"timken", weak:true, name:"Timken", oem:false, dom:/timken/i, txt:/TIMKEN/, pn:[/\b(\d{3,6}\/?\d{0,5}[A-Z]?)\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"parker", weak:true, name:"Parker", oem:false, dom:/parker/i, txt:/PARKER/, pn:[/\b([0-9A-Z]{2,4}-[0-9A-Z]{2,6}(?:-[0-9A-Z]{1,6})?)\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"gates", weak:true, name:"Gates", oem:false, dom:/gates/i, txt:/GATES/, pn:[/\b(\d{4,5}[A-Z]{0,3})\b/g], fmt:(m)=>m[1], links:()=>[] },
  { id:"denso", weak:true, name:"Denso", oem:false, dom:/denso/i, txt:/DENSO/, pn:[/\b(\d{6}-\d{4})\b/g], fmt:(m)=>m[1], links:()=>[] },
];
const brandById = (id) => BRANDS.find(b=>b.id===id);
const keyOf = (pn) => (pn||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const genericLinks = (pn) => [
  { t:"بحث Cross Reference على Google", u:g(pn+" cross reference") },
  { t:"بحث المعدات اللي بتستخدمها القطعة", u:g(pn+" fits models applications") },
];

/* =====================================================================
   2) CODE PAYLOAD PARSING — URL, GS1, GS1 Digital Link, key:value text
   ===================================================================== */
const GS1 = {
  "00":{n:"SSCC (رقم الشحنة)",l:18}, "01":{n:"GTIN (رقم المنتج العالمي)",l:14}, "02":{n:"GTIN المحتوى",l:14},
  "10":{n:"رقم اللوط / الدفعة"}, "11":{n:"تاريخ الإنتاج",l:6,d:1}, "13":{n:"تاريخ التعبئة",l:6,d:1},
  "15":{n:"أفضل استخدام قبل",l:6,d:1}, "16":{n:"تاريخ البيع حتى",l:6,d:1}, "17":{n:"تاريخ الانتهاء",l:6,d:1},
  "20":{n:"متغيّر المنتج",l:2}, "21":{n:"الرقم التسلسلي (S/N)"}, "22":{n:"معرّف ثانوي"},
  "240":{n:"رقم القطعة (معرّف إضافي)",pn:1}, "241":{n:"رقم قطعة العميل",pn:1}, "250":{n:"سيريال ثانوي"},
  "30":{n:"الكمية"}, "37":{n:"عدد الوحدات"}, "400":{n:"رقم أمر الشراء"}, "422":{n:"بلد المنشأ (كود)",l:3},
  "7003":{n:"تاريخ الصلاحية والوقت",l:10}, "8004":{n:"GIAI (رقم الأصل)"}, "91":{n:"بيانات داخلية للشركة"},
  "92":{n:"بيانات داخلية"}, "93":{n:"بيانات داخلية"}, "94":{n:"بيانات داخلية"}, "95":{n:"بيانات داخلية"},
  "96":{n:"بيانات داخلية"}, "97":{n:"بيانات داخلية"}, "98":{n:"بيانات داخلية"}, "99":{n:"بيانات داخلية"},
};
const AR_M = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const gsDate = (s) => { const y=2000+ +s.slice(0,2), m=+s.slice(2,4), d=+s.slice(4,6);
  return m>=1&&m<=12 ? `${d?d+" ":""}${AR_M[m-1]} ${y}` : s; };

function parseGS1(raw) {
  let s = raw.replace(/^\][A-Za-z]\d/, "");
  const GS = "\u001d";
  const out = [];
  let i = 0, guard = 0;
  while (i < s.length && guard++ < 40) {
    if (s[i] === GS) { i++; continue; }
    let ai = null;
    for (const len of [4,3,2]) { const c = s.substr(i,len); if (GS1[c]) { ai = c; break; } }
    if (!ai) return out.length ? out : null;
    const def = GS1[ai]; i += ai.length;
    let v;
    if (def.l) { v = s.substr(i, def.l); i += def.l; }
    else { const e = s.indexOf(GS, i); v = e<0 ? s.slice(i) : s.slice(i, e); i = e<0 ? s.length : e+1; }
    out.push({ ai, label: def.n, value: def.d ? gsDate(v)+` (${v})` : v, rawv:v, pn: !!def.pn });
  }
  return out.length ? out : null;
}

function parsePayload(raw, format) {
  const res = { raw, format, kind:"text", fields:[], brand:null, pns:[], note:"" };
  const t = raw.trim();
  // URL
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) {
    res.kind = "url";
    try {
      const u = new URL(/^www\./i.test(t) ? "https://"+t : t);
      res.fields.push({ label:"الموقع", value:u.hostname });
      const b = BRANDS.find(b=>b.dom.test(u.hostname));
      if (b) { res.brand = b.id; res.fields.push({ label:"الجهة المصدرة", value:b.name }); }
      // GS1 Digital Link /01/xxxxx/10/yyy
      const seg = u.pathname.split("/").filter(Boolean);
      const dl = [];
      for (let k=0;k<seg.length-1;k++) if (GS1[seg[k]] && /^[\w.-]+$/.test(seg[k+1])) { dl.push({ai:seg[k], label:GS1[seg[k]].n, value:decodeURIComponent(seg[k+1]), pn:!!GS1[seg[k]].pn}); k++; }
      if (dl.length>=1 && dl.some(d=>d.ai==="01")) { res.kind="gs1"; res.fields.push(...dl); }
      for (const [k,v] of u.searchParams) {
        res.fields.push({ label:k, value:v });
        if (/^(pn|part|partno|partnumber|p|sku|item|mpn)$/i.test(k)) res.pns.push({ pn:v, brand:res.brand, src:"code" });
      }
      for (const sgm of seg) for (const b of BRANDS) for (const re of b.pn) {
        re.lastIndex=0; const m = re.exec(sgm.toUpperCase()); if (m && (!res.brand || res.brand===b.id)) res.pns.push({ pn:b.fmt(m), brand:b.id, src:"code" });
      }
      if (res.brand==="cat" && /parts-packaging/.test(u.pathname))
        res.note = "ده QR عام بتاع تغليف CAT: كل الملصقات عليها نفس اللينك، ومفيهوش رقم القطعة ولا سيريال. رقم القطعة بيتاخد من نص الملصق.";
    } catch(e) {}
    return res;
  }
  // CAT packaging barcode: CAT + label rev + origin + level + part number  (e.g. CATAAMX--4798991)
  const cm = t.toUpperCase().match(/^CAT([A-Z0-9]{2})([A-Z]{2})(.{2})(\d{7}|\d[A-Z]\d{4})$/);
  if (cm) {
    const p = /^\d{7}$/.test(cm[4]) ? cm[4].slice(0,3)+"-"+cm[4].slice(3) : cm[4].slice(0,2)+"-"+cm[4].slice(2);
    res.kind="cat"; res.brand="cat";
    res.fields.push({label:"الشركة", value:"Caterpillar"},{label:"رقم القطعة", value:p},{label:"بلد المنشأ", value:cm[2]},
                    {label:"كود الملصق", value:cm[1]},{label:"Level", value:cm[3]});
    res.pns.push({ pn:p, brand:"cat", src:"code", strong:true });
    return res;
  }
  // GS1 element string
  if (/^(\][A-Za-z]\d)?(01\d{14}|00\d{18}|\u001d?(10|21|240)\S)/.test(t) || t.includes("\u001d")) {
    const f = parseGS1(t);
    if (f) { res.kind="gs1"; res.fields=f; f.filter(x=>x.pn).forEach(x=>res.pns.push({pn:x.rawv||x.value, brand:null, src:"code"})); }
  }
  // key:value
  if (res.kind==="text") {
    const parts = t.split(/[\n;|]+/);
    for (const p of parts) {
      const m = p.match(/^\s*([A-Za-z#./ ]{1,14})\s*[:=]\s*(.+)$/);
      if (m) {
        res.fields.push({ label:m[1].trim(), value:m[2].trim() });
        if (/^(P\/?N|PART|PART ?NO|MPN|ITEM)/i.test(m[1].trim())) res.pns.push({ pn:m[2].trim(), brand:null, src:"code" });
      }
    }
    const b = BRANDS.find(b=>b.txt.test(t.toUpperCase())); if (b) res.brand=b.id;
  }
  res.pns.push(...extractPNs(t, res.brand, "code"));
  return res;
}

function extractPNs(text, brandHint, src) {
  const T = (text||"").toUpperCase();
  const found = [];
  const ctx = BRANDS.filter(b=>b.txt.test(T)).map(b=>b.id);
  for (const b of BRANDS) {
    const strong = b.id===brandHint || ctx.includes(b.id);
    // generic 7/8-digit and short patterns only count when the brand is on the label
    for (const re of b.pn) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(T))) {
        if (b.weak && !strong) continue;
        found.push({ pn:b.fmt(m), brand:b.id, src, strong });
      }
    }
  }
  return found;
}

/* label description → Arabic part type (CAT / Komatsu style abbreviations) */
const DESC_WORDS = [[/ELEMENT/,"عنصر"],[/FILTER|FLTR/,"فلتر"],[/BREATHER/,"تنفيس"],[/STRAINER/,"مصفاة"],[/SEPARATOR|SEP\b/,"فاصل"],
  [/\bAS\b/,"تجميعة"],[/OIL|LUBE/,"زيت"],[/FUEL/,"ديزل"],[/WATER/,"مياه"],[/HYD|HYDRAULIC/,"هيدروليك"],[/TRANS/,"ناقل الحركة"],
  [/CAB/,"كابينة"],[/AIR|-\s?A\b|AS\s?-\s?A\b/,"هوا"],[/SEC|SECONDARY|INNER/,"ثانوي (داخلي)"],[/PRI|PRIMARY|OUTER/,"أساسي (خارجي)"],[/COOLANT/,"مياه تبريد"]];
function labelDesc(text) {
  const lines = (text||"").toUpperCase().split("\n");
  const line = lines.find(l=>/(FILTER|ELEMENT|BREATHER|STRAINER|SEPARATOR)/.test(l));
  if (!line) return null;
  const m = line.match(/(FILTER|ELEMENT|BREATHER|STRAINER|SEPARATOR)[A-Z\s\-–—]{0,22}/);
  const raw = m[0].replace(/[–—]/g,"-").replace(/\s+/g," ").trim();
  const ar = []; DESC_WORDS.forEach(([re,w])=>{ if (re.test(raw) && !ar.includes(w)) ar.push(w); });
  return { raw, ar: ar.join(" ") };
}

/* label production date (CAT D..M..Y) */
function labelDate(text) {
  const m = (text||"").toUpperCase().match(/[DPO0]\s?([0-9OQ]{2})\s?M\s?([0-9OQ]{2})\s?Y\s?([0-9OQ]{2})/);
  if (!m) {
    const p = (text||"").match(/\b(\d{2})[.\/-](\d{2})[.\/-](20\d{2}|\d{2})\b/);
    if (p) { const d=+p[1], mo=+p[2], y=p[3].length===2?2000+ +p[3]:+p[3];
      if (mo>=1&&mo<=12&&d>=1&&d<=31&&y<=new Date().getFullYear()) return { text:`${d} ${AR_M[mo-1]} ${y}`, code:p[0] }; }
    return null;
  }
  const f = (s)=>+s.replace(/[OQ]/g,"0"); const d=f(m[1]), mo=f(m[2]), y=2000+f(m[3]);
  if (mo<1||mo>12||d<1||d>31) return null;
  return { text:`${d} ${AR_M[mo-1]} ${y}`, code:`D${m[1]}M${m[2]}Y${m[3]}` };
}

/* =====================================================================
   3) IMAGE DECODING — BarcodeDetector → ZXing → jsQR, + OCR
   ===================================================================== */
function loadImage(file) {
  return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=URL.createObjectURL(file); });
}
function toCanvas(img, sc=1, crop) {
  const [sx,sy,sw,sh] = crop || [0,0,img.naturalWidth,img.naturalHeight];
  const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(sw*sc)); c.height=Math.max(1,Math.round(sh*sc));
  c.getContext("2d",{willReadFrequently:true}).drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height); return c;
}
const FMT_NAMES = { qr_code:"QR", data_matrix:"DataMatrix", aztec:"Aztec", pdf417:"PDF417", code_128:"Code128", code_39:"Code39", ean_13:"EAN-13", upc_a:"UPC-A", itf:"ITF", ean_8:"EAN-8", code_93:"Code93", codabar:"Codabar", upc_e:"UPC-E" };

function find2D(img) {
  const W=img.naturalWidth,H=img.naturalHeight, sc=900/Math.max(W,H);
  const c=toCanvas(img, sc), w=c.width, h=c.height, d=c.getContext("2d").getImageData(0,0,w,h).data, g=new Float32Array(w*h);
  for (let i=0,j=0;i<d.length;i+=4,j++) g[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
  const CS=6, cw=Math.floor(w/CS), ch=Math.floor(h/CS), mx=new Float32Array(cw*ch), my=new Float32Array(cw*ch);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) { const i=y*w+x, cx=Math.min(cw-1,(x/CS)|0), cy=Math.min(ch-1,(y/CS)|0);
    if (Math.abs(g[i+1]-g[i-1])>40) mx[cy*cw+cx]++; if (Math.abs(g[i+w]-g[i-w])>40) my[cy*cw+cx]++; }
  const on=new Uint8Array(cw*ch); for (let i=0;i<on.length;i++) on[i]=(mx[i]>CS*CS*0.12&&my[i]>CS*CS*0.12)?1:0;
  const seen=new Uint8Array(cw*ch), out=[];
  for (let i=0;i<on.length;i++) { if (!on[i]||seen[i]) continue; const st=[i]; seen[i]=1; let x0=1e9,y0=1e9,x1=-1,y1=-1,n=0;
    while (st.length) { const k=st.pop(), kx=k%cw, ky=(k/cw)|0; n++; x0=Math.min(x0,kx); x1=Math.max(x1,kx); y0=Math.min(y0,ky); y1=Math.max(y1,ky);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx=kx+dx, ny=ky+dy; if (nx<0||ny<0||nx>=cw||ny>=ch) continue; const q=ny*cw+nx; if (on[q]&&!seen[q]) { seen[q]=1; st.push(q); } } }
    const bw=x1-x0+1, bh=y1-y0+1;
    if (n>=4 && bw/bh>0.4 && bw/bh<2.5 && n/(bw*bh)>0.45 && bw*bh<cw*ch*0.25) out.push([x0*CS/sc,y0*CS/sc,bw*CS/sc,bh*CS/sc,n]); }
  return out.sort((a,b)=>b[4]-a[4]);
}

async function decodeCodes(img, label) {
  const found = new Map();
  const add = (text, fmt) => { if (text && !found.has(text)) found.set(text, fmt); };
  // a) native BarcodeDetector (Android Chrome, Safari 17+)
  try {
    if ("BarcodeDetector" in window) {
      const fm = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({ formats: fm });
      const r = await det.detect(img);
      r.forEach(x=>add(x.rawValue, FMT_NAMES[x.format]||x.format));
    }
  } catch(e) {}
  // b) ZXing multi-format on whole image + tiles
  try {
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.AZTEC,
      Z.BarcodeFormat.PDF_417, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.ITF]);
    const reader = new Z.MultiFormatReader(); reader.setHints(hints);
    const W=img.naturalWidth, H=img.naturalHeight;
    const jobs = [];
    if (label) { jobs.push([1,label,"label"]); jobs.push([1,[label[0],label[1]+label[3]*0.55,label[2],label[3]*0.45],"label"]); }
    jobs.push([1,null],[0.6,null],[0.4,null]);
    for (const [cx,cy] of [[0,0],[0.5,0],[0,0.5],[0.5,0.5],[0.25,0.25]]) jobs.push([1,[cx*W,cy*H,W/2,H/2]]);
    for (let k=0;k<6;k++) jobs.push([1,[0,k*H/8,W,H/4],"strip"]);
    const gotPN = () => [...found.keys()].some(t => parsePayload(t, "").pns.length > 0);
    for (const [sc,crop,kind] of jobs) {
      if (kind!=="label" && gotPN()) break;
      if (kind==="strip" && [...found.values()].some(f=>/128|39|EAN|UPC|ITF/i.test(String(Z.BarcodeFormat[f]||f)))) break;
      const c = toCanvas(img, kind==="label" ? Math.min(2, 1600/crop[2]) : kind==="strip" ? 1 : Math.min(sc, 1800/Math.max(W,H)*(crop?2:1)), crop);
      const d = c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      const lum = new Uint8ClampedArray(c.width*c.height);
      for (let i=0,j=0;i<d.length;i+=4,j++) lum[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
      try {
        const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height))), hints);
        add(r.getText(), Z.BarcodeFormat[r.getBarcodeFormat()]);
      } catch(e) {}
    }
    // small 2D codes (DataMatrix / QR): locate dense 2-D texture blobs, then decode each one upscaled
    const dmR = new Z.DataMatrixReader(), qrR = new Z.QRCodeReader();
    // always look for 2-D codes (QR / DataMatrix) — even when a barcode already gave the part number
    for (const [bx,by,bw,bh] of find2D(img).slice(0,40)) {
      const p = Math.max(bw,bh)*0.3, sx=Math.max(0,bx-p), sy=Math.max(0,by-p), cw=Math.min(W-sx,bw+2*p), chh=Math.min(H-sy,bh+2*p);
      for (const tgt of [300,500]) {
        const c = toCanvas(img, tgt/Math.max(cw,chh), [sx,sy,cw,chh]);
        const d = c.getContext("2d").getImageData(0,0,c.width,c.height).data, lum = new Uint8ClampedArray(c.width*c.height);
        for (let i=0,j=0;i<d.length;i+=4,j++) lum[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
        let hit = false;
        for (const [rd, f] of [[dmR,"DATA_MATRIX"],[qrR,"QR_CODE"]]) {
          try { const r = rd.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height))), hints); add(r.getText(), f); hit = true; } catch(e) {}
        }
        if (!hit && typeof jsQR === "function") { const q = jsQR(d, c.width, c.height); if (q && q.data) { add(q.data, "QR_CODE"); hit = true; } }
        if (hit) break;
      }
    }
  } catch(e) { console.warn(e); }
  // c) jsQR fallback for QR
  if (typeof jsQR === "function" && ![...found.values()].some(f=>/QR/i.test(f))) {
    const M = Math.max(img.naturalWidth, img.naturalHeight);
    for (const sc of [Math.min(1,1600/M), Math.min(0.6,1000/M), Math.min(0.4,700/M)]) {
      const c = toCanvas(img, sc); const r = jsQR(c.getContext("2d").getImageData(0,0,c.width,c.height).data, c.width, c.height);
      if (r && r.data) { add(r.data, "QR_CODE"); break; }
    }
  }
  return [...found.entries()].map(([text,fmt])=>({ text, fmt: String(fmt).replace("_CODE","").replace("_"," ") }));
}

/* find the CAT-yellow label area so codes & text are read at full resolution */
function findLabel(img) {
  const W=img.naturalWidth, H=img.naturalHeight, sc=320/Math.max(W,H);
  const c = toCanvas(img, sc), w=c.width, h=c.height, d=c.getContext("2d").getImageData(0,0,w,h).data;
  const cols=new Array(w).fill(0), rows=new Array(h).fill(0); let n=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) { const i=(y*w+x)*4, r=d[i], g=d[i+1], b=d[i+2];
    if (r>170 && g>120 && b<120 && r-b>90 && Math.abs(r-g)<90) { cols[x]++; rows[y]++; n++; } }
  if (n < w*h*0.015) return null;
  const span = (arr, len) => { const th=Math.max(2, Math.max(...arr)*0.25); let a=0,b=len-1; while(a<len&&arr[a]<th)a++; while(b>0&&arr[b]<th)b--; return [a,b]; };
  let [x0,x1]=span(cols,w), [y0,y1]=span(rows,h);
  if (x1<=x0||y1<=y0) return null;
  const mx=(x1-x0)*0.08, my=(y1-y0)*0.35;   // labels have a white band under the yellow part (barcode)
  x0=Math.max(0,x0-mx); x1=Math.min(w,x1+mx); y0=Math.max(0,y0-my*0.3); y1=Math.min(h,y1+my);
  if ((x1-x0)*(y1-y0) > w*h*0.9) return null;
  return [x0/sc, y0/sc, (x1-x0)/sc, (y1-y0)/sc];
}

const base = (p) => new URL(p, document.baseURI).href;
let ocrWorker = null, ocrProgress = ()=>{};
function getOCR() {
  if (!ocrWorker) ocrWorker = fetch(base("lib/lang/eng-traineddata.wasm")).then(r=>r.arrayBuffer())
    .then(buf=>Tesseract.createWorker([{code:"eng", data:new Uint8Array(buf)}], 1, {
      workerPath:base("lib/worker.min.js"), corePath:base("lib/core/"), workerBlobURL:false, cacheMethod:"none",
      logger:(m)=>ocrProgress(m) }))
    .catch(e=>{ ocrWorker=null; throw e; });
  return ocrWorker;
}
async function runOCR(img, label) {
  const w = await getOCR();
  await w.setParameters({ tessedit_pageseg_mode:"11" });
  const W=img.naturalWidth,H=img.naturalHeight;
  const c = label ? toCanvas(img, Math.min(2.5, 1800/label[2]), label) : toCanvas(img, Math.min(1, 2200/Math.max(W,H))); const x=c.getContext("2d"); const id=x.getImageData(0,0,c.width,c.height), p=id.data;
  for (let i=0;i<p.length;i+=4){ let v=0.3*p[i]+0.59*p[i+1]+0.11*p[i+2]; v=Math.max(0,Math.min(255,(v-128)*1.6+128)); p[i]=p[i+1]=p[i+2]=v; }
  x.putImageData(id,0,0);
  const { data } = await w.recognize(c);
  return (data.text||"").split("\n").map(s=>s.trim()).filter(s=>s.length>2).join("\n");
}

/* Claude vision: read the label like a human inspector */
async function visionRead(sample, img, label) {
  const crop = label || [0,0,img.naturalWidth,img.naturalHeight];
  const c = toCanvas(img, Math.min(1, 1600/Math.max(crop[2],crop[3])), crop);
  const blob = await new Promise(r=>c.toBlob(r,"image/jpeg",0.85));
  const prompt = `دي صورة ملصق أو جسم قطعة غيار معدات ثقيلة. اقرا كل المكتوب عليها بدقة.
رجّع JSON فقط:
{"brand":"اسم الشركة على الملصق","partNumber":"رقم القطعة الرئيسي بالظبط زي ما مكتوب (بالشُرَط)","description":"وصف القطعة المكتوب على الملصق بالإنجليزي",
"typeAr":"نوع القطعة بالعربي","origin":"بلد المنشأ","quantity":"الكمية","dateCode":"أي كود تاريخ/لوط أو تاريخ مطبوع زي D03M02Y26 أو 227011E أو 28.08.24","serial":"الرقم التسلسلي لو موجود (S/N أو (21))","otherNumbers":["أي أرقام قطع تانية"],"text":"كل النص المقروء سطر بسطر"}
لو مش واضح حاجة اكتبها "" — ممنوع التخمين.`;
  const r = await sample(prompt, { images:[blob], modelTier:"default" });
  const t = r.text||""; return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}")+1));
}

/* =====================================================================
   4) AI LOOKUP (Claude via `sample`) — clearly marked as unverified
   ===================================================================== */
const AI_SCHEMA = `{
 "partNumber": "رقم القطعة بالصيغة الرسمية",
 "manufacturer": "الشركة صاحبة الرقم",
 "isOEM": true,
 "category": "Filter | Engine | Hydraulic | Undercarriage | Electrical | GET | Seal | Bearing | Other",
 "typeEn": "e.g. Engine Oil Filter",
 "typeAr": "اسم القطعة بالعربي",
 "description": "وصف فني مختصر بالعربي (سطرين)",
 "specs": [{"k":"Height","v":"..."}],
 "supersession": {"replaces": ["أرقام قديمة"], "replacedBy": ["رقم أحدث إن وجد"]},
 "oemAlternates": [{"brand":"Caterpillar","pn":"...","note":""}],
 "equipment": [{"brand":"Caterpillar","type":"Wheel Loader","models":["950H","962H"],"engine":"C7","confidence":"medium"}],
 "aftermarket": [{"brand":"Donaldson","pn":"P551808","confidence":"high|medium|low"}],
 "notes": "تحذيرات مهمة: اختلاف مقاسات/إصدارات/سيريال"
}`;
async function aiLookup(sample, pn, ctx) {
  const prompt = `أنت مهندس قطع غيار معدات ثقيلة خبير في الـ Cross Reference.
رقم القطعة: ${pn}
${ctx.brand ? "الماركة المرجّحة: "+ctx.brand : ""}
${ctx.desc ? "وصف القطعة على الملصق: "+ctx.desc : ""}
${ctx.label ? "نص الملصق (OCR):\n"+ctx.label.slice(0,600) : ""}
${ctx.codes ? "محتوى الأكواد: "+ctx.codes.slice(0,400) : ""}

المطلوب: تعريف القطعة وكل الأرقام البديلة.
قواعد صارمة:
- أرقام القطع البديلة: اكتب فقط اللي انت متأكد منه فعلاً، وممنوع تأليف أرقام.
- المعدات: اكتب الموديلات اللي تعرفها حتى لو ثقتك متوسطة، وحدد confidence لكل مجموعة (high/medium/low). ماتسيبش المعدات فاضية لو تعرف عائلة المحركات أو الموديلات المرجّحة.
- النوع: لو الملصق بيقول ELEMENT أو FILTER بس، استنتج النوع (هوا/زيت/ديزل/هيدروليك) من معرفتك بالرقم.
- confidence: high = رقم مشهور ومتطابق في كتالوجات متعددة، medium = غالباً صحيح، low = محتمل.
- غطّي لو تعرف: Donaldson, Fleetguard, Baldwin, WIX, MANN-FILTER, HIFI, Sakura, Hengst, Luber-finer.
- المعدات: اكتب كل الموديلات والمحركات اللي تعرفها، مقسّمة حسب نوع المعدة (Wheel Loader / Excavator / Motor Grader ...) في الحقل type، زي ما كتالوج الشركة بيعرضها.
- النصوص الوصفية بالعربي، والأرقام والموديلات بالإنجليزي.
رجّع JSON فقط بالشكل ده:
${AI_SCHEMA}`;
  const r = await sample(prompt, { modelTier:"complex" });
  const t = r.text || "";
  const j = t.slice(t.indexOf("{"), t.lastIndexOf("}")+1);
  return JSON.parse(j);
}

/* =====================================================================
   5) UI
   ===================================================================== */
function db0Test(d, id) { if (id) d.collection("data/users/"+id); }
const Icon = ({ n, ...p }) => { const C = L[n] || L.Circle; return <C {...p}/>; };
const Badge = ({ kind, children }) => <span className={"badge "+kind}>{children}</span>;
const confAr = { high:"ثقة عالية", medium:"ثقة متوسطة", low:"ثقة منخفضة" };

function Section({ icon, title, right, children }) {
  return <section className="sec"><header><Icon n={icon} size={18}/><h3>{title}</h3>{right}</header>{children}</section>;
}

function CodeCard({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="code">
      <div className="code-h">
        <Badge kind="fmt">{c.fmt}</Badge>
        <Badge kind={c.p.kind}>{c.p.kind==="url"?"لينك":c.p.kind==="gs1"?"GS1":c.p.kind==="cat"?"باركود CAT":"نص"}</Badge>
        {c.p.brand && <Badge kind="brand">{brandById(c.p.brand).name}</Badge>}
        <button className="mini" onClick={()=>setOpen(!open)}>{open?"إخفاء":"المحتوى الخام"}</button>
      </div>
      {c.p.fields.length>0 && <table className="kv"><tbody>
        {c.p.fields.map((f,i)=><tr key={i}><td>{f.label}{f.ai?<small dir="ltr"> ({f.ai})</small>:null}</td><td dir="ltr">{f.value}</td></tr>)}
      </tbody></table>}
      {c.p.note && <p className="note"><Icon n="Info" size={14}/> {c.p.note}</p>}
      {open && <pre dir="ltr">{c.text.replace(/\u001d/g,"<GS>")}</pre>}
    </div>);
}

function PartView({ pn, brandHint, rec, ai, aiState, onAI, onRequest, reqState, ocrText, codesText, date, desc }) {
  const b = brandById(rec?.brand || brandHint || ai?.brandId);
  const links = [...(b ? b.links(rec?.pn||pn) : []), ...genericLinks(rec?.pn||pn)];
  const src = rec ? "verified" : ai ? "ai" : "none";
  const type = rec?.typeAr || ai?.typeAr || (desc && desc.ar);
  const recAft = rec?.aftermarket || [];
  const aft = [...recAft, ...((ai?.aftermarket)||[]).filter(a=>!recAft.some(r=>keyOf(r.pn)===keyOf(a.pn))).map(a=>({...a, ai:true}))];
  const shownPn = rec?.pn || pn;
  const viaAlias = rec && keyOf(rec.pn)!==keyOf(pn);
  const byBrand = {};
  aft.forEach(a=>{ (byBrand[a.brand] = byBrand[a.brand] || []).push(a); });
  const eq = (rec?.equipment||[]).length ? rec.equipment : (ai?.equipment || []);
  const sup = rec?.supersession || ai?.supersession;
  const oemAlt = rec?.oemAlternates || ai?.oemAlternates || [];
  const specs = rec?.specs || ai?.specs || [];

  const copy = () => {
    const lines = [`رقم القطعة: ${shownPn}`, `الشركة: ${rec?.manufacturer||ai?.manufacturer||b?.name||"-"}`, `النوع: ${type||"-"}`,
      date?`تاريخ الإنتاج (الملصق): ${date.text}`:"",
      sup&&(sup.replaces||[]).length?`يحل محل: ${sup.replaces.join(", ")}`:"", sup&&(sup.replacedBy||[]).length?`استُبدل بـ: ${sup.replacedBy.join(", ")}`:"",
      oemAlt.length?"بدائل OEM: "+oemAlt.map(a=>a.brand+" "+a.pn).join(" | "):"",
      aft.length?"Aftermarket:\n"+aft.map(a=>`- ${a.brand}: ${a.pn}`).join("\n"):"",
      eq.length?"المعدات: "+eq.map(e=>`${e.brand} ${(e.models||[]).join(", ")}`).join(" | "):"",
      `المصدر: ${src==="verified"?"قاعدة بيانات موثّقة":src==="ai"?"تقدير AI (غير موثّق)":"-"}`].filter(Boolean);
    navigator.clipboard?.writeText(lines.join("\n")).catch(()=>{});
  };

  return (
    <div className="part">
      <div className="part-top">
        <div>
          <div className="pn" dir="ltr">{shownPn}</div>
          {viaAlias && <div className="alias">الرقم اللي دوّرت عليه <code dir="ltr">{pn}</code> متسجّل كرقم بديل/مرتبط للقطعة دي</div>}
          <div className="pt">{type || "نوع القطعة غير محدد بعد"}{(rec?.typeEn||ai?.typeEn) && <span dir="ltr"> · {rec?.typeEn||ai?.typeEn}</span>}</div>
        </div>
        <div className="mfr">
          {b && <Badge kind={b.oem?"oem":"am"}>{b.oem?"OEM":"Aftermarket"}</Badge>}
          <b>{rec?.manufacturer || (brandHint && b?.name) || ai?.manufacturer || b?.name || "شركة غير معروفة"}</b>
        </div>
      </div>
      <div className="srcbar">
        {src==="verified" && <Badge kind="ok"><Icon n="ShieldCheck" size={13}/> موثّق من مصادر ({(rec.sources||[]).length})</Badge>}
        {src==="ai" && <Badge kind="warn"><Icon n="Bot" size={13}/> تقدير AI، لازم يتراجع قبل الطلب</Badge>}
        {src==="none" && <Badge kind="mute">مش موجود في القاعدة الموثّقة</Badge>}
        {desc && <Badge kind="mute"><Icon n="Tag" size={13}/> الملصق: <span dir="ltr">{desc.raw}</span></Badge>}
        {aiState==="busy" && <Badge kind="warn"><Icon n="Loader2" size={13} className="spin"/> بيجيب المعدات والبدائل…</Badge>}
        {date && <Badge kind="date"><Icon n="Calendar" size={13}/> إنتاج: {date.text} (من قراءة الملصق، راجعه)</Badge>}
      </div>
      {(rec?.description||ai?.description) && <p className="desc">{rec?.description||ai?.description}</p>}

      <div className="actions">
        {aiState!=="busy" && <button className="btn y" onClick={onAI}><Icon n="Sparkles" size={18}/>{ai?"إعادة البحث بالـAI":rec?"إكمال البيانات بالـAI":"ابحث بالـAI"}</button>}
        {aiState==="busy" && <button className="btn y" disabled><Icon n="Loader2" size={18} className="spin"/> بيدوّر على البدائل…</button>}
        <button className="btn d" onClick={copy}><Icon n="Copy" size={18}/> نسخ التقرير</button>
        {src!=="verified" && <button className="btn d" disabled={reqState==="done"} onClick={onRequest}>
          <Icon n={reqState==="done"?"Check":"Send"} size={18}/>{reqState==="done"?"اتبعت للتوثيق":"اطلب توثيق"}</button>}
      </div>
      {aiState && aiState.startsWith && aiState.startsWith("err") && <p className="note bad">{aiState.slice(4)}</p>}

      {specs.length>0 && <Section icon="Ruler" title="المواصفات">
        <table className="kv"><tbody>{specs.map((s,i)=><tr key={i}><td>{s.k}</td><td dir="ltr">{s.v}</td></tr>)}</tbody></table></Section>}

      {(sup && ((sup.replaces||[]).length || (sup.replacedBy||[]).length)) || oemAlt.length ? (
        <Section icon="Layers" title="Supersession والبدائل الأصلية (OEM)">
          {(sup?.replacedBy||[]).length>0 && <div className="row"><span className="lbl">استُبدل بـ (الأحدث)</span>{sup.replacedBy.map(x=><code key={x} className="pnchip new">{x}</code>)}</div>}
          {(sup?.replaces||[]).length>0 && <div className="row"><span className="lbl">بيحل محل (أقدم)</span>{sup.replaces.map(x=><code key={x} className="pnchip">{x}</code>)}</div>}
          {oemAlt.length>0 && <div className="row"><span className="lbl">أرقام OEM مكافئة</span>{oemAlt.map((a,i)=><code key={i} className="pnchip">{a.brand} {a.pn}</code>)}</div>}
        </Section>) : null}

      <Section icon="Boxes" title={`بدائل Aftermarket (${aft.length})`}>
        {aft.length===0 && <p className="muted">مفيش بدائل مسجّلة. دوس "ابحث بالـAI" أو استخدم لينكات البحث تحت.</p>}
        {Object.entries(byBrand).map(([br, list])=>(
          <div key={br} className="am">
            <div className="am-b">{br}</div>
            <div className="am-l">{list.map((a,i)=>(
              <div key={i} className="am-i">
                <code dir="ltr">{a.pn}</code>
                {a.ai && <span className="conf low">AI</span>}
                {a.confidence && <span className={"conf "+a.confidence}>{confAr[a.confidence]||a.confidence}</span>}
                {a.src && <a href={a.src} target="_blank" rel="noopener" className="srclink"><Icon n="ExternalLink" size={12}/> المصدر</a>}
              </div>))}</div>
          </div>))}
      </Section>

      <Section icon="Truck" title="المعدات اللي بتستخدم القطعة">
        {eq.length===0 && <p className="muted">مش متسجّل.</p>}
        {eq.map((e,i)=>(
          <div key={i} className="eq"><b>{e.type || e.brand}</b>{e.type && <small> · {e.brand}</small>}{e.engine && <small dir="ltr"> · Engine {e.engine}</small>}
            {e.confidence && <span className={"conf "+e.confidence} style={{marginInlineStart:6}}>{confAr[e.confidence]}</span>}
            <div className="chips">{(e.models||[]).map(m=><span key={m} className="chip" dir="ltr">{m}</span>)}</div></div>))}
      </Section>

      {(rec?.notes||ai?.notes) && <Section icon="AlertTriangle" title="ملاحظات فنية"><p className="desc">{rec?.notes||ai?.notes}</p></Section>}

      <Section icon="Link" title="تحقّق من المصدر الرسمي">
        <div className="links">{links.map((l,i)=><a key={i} href={l.u} target="_blank" rel="noopener"><Icon n="ExternalLink" size={14}/> {l.t}</a>)}</div>
        {rec?.sources?.length>0 && <><div className="lbl" style={{marginTop:10}}>مصادر التوثيق</div>
          <div className="links">{rec.sources.map((s,i)=><a key={i} href={s.url} target="_blank" rel="noopener"><Icon n="FileText" size={14}/> {s.title}</a>)}</div></>}
      </Section>
    </div>);
}


/* =====================================================================
   LIVE CAMERA SCANNER — reads codes continuously from the video stream
   ===================================================================== */
function LiveScanner({ onDone, onClose }) {
  const vRef = useRef(), stopRef = useRef(false), streamRef = useRef(null);
  const [status, setStatus] = useState("بيفتح الكاميرا…");
  const [seen, setSeen] = useState([]);
  const seenRef = useRef([]);
  const [torch, setTorch] = useState(false);

  const grab = () => {
    const v = vRef.current; const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
    return new Promise(res => c.toBlob(b => res(b), "image/jpeg", 0.92));
  };
  const finish = async () => {
    if (stopRef.current) return; stopRef.current = true;
    const blob = await grab();
    if (navigator.vibrate) navigator.vibrate(80);
    onDone(blob, seenRef.current.slice());
  };

  useEffect(() => {
    let timer = null, det = null, reader = null, hints = null;
    (async () => {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1920 }, height:{ ideal:1080 } } });
        streamRef.current = st; const v = vRef.current; v.srcObject = st; await v.play();
        setStatus("وجّه الكاميرا على الكود أو الملصق");
      } catch (e) { setStatus("مش قادر أفتح الكاميرا. اسمح بالكاميرا للموقع من إعدادات المتصفح."); return; }
      try { if ("BarcodeDetector" in window) det = new BarcodeDetector({ formats: await BarcodeDetector.getSupportedFormats() }); } catch(e) {}
      const Z = window.ZXing;
      if (Z) { hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.ITF, Z.BarcodeFormat.PDF_417]);
        reader = new Z.MultiFormatReader(); reader.setHints(hints); }
      const c = document.createElement("canvas"); const x = c.getContext("2d", { willReadFrequently:true });
      let flip = 0, firstSeenAt = 0;
      const tick = async () => {
        if (stopRef.current) return;
        const v = vRef.current;
        if (v && v.videoWidth) {
          const found = [];
          try {
            if (det) { (await det.detect(v)).forEach(r => found.push({ text:r.rawValue, fmt:(FMT_NAMES[r.format]||r.format) })); }
            else {
              // centre crop (where the guide box is), alternating zoom levels
              const W = v.videoWidth, H = v.videoHeight, z = [0.9, 0.55][flip++ % 2];
              const cw = W*z, ch = H*z, sc = Math.min(1, 1100/cw);
              c.width = Math.round(cw*sc); c.height = Math.round(ch*sc);
              x.drawImage(v, (W-cw)/2, (H-ch)/2, cw, ch, 0, 0, c.width, c.height);
              const d = x.getImageData(0,0,c.width,c.height).data;
              if (reader) { const lum = new Uint8ClampedArray(c.width*c.height);
                for (let i=0,j=0;i<d.length;i+=4,j++) lum[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
                try { const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height))), hints);
                  found.push({ text:r.getText(), fmt:String(Z.BarcodeFormat[r.getBarcodeFormat()]).replace("_CODE","").replace("_"," ") }); } catch(e) {} }
              if (!found.length && typeof jsQR === "function") { const q = jsQR(d, c.width, c.height); if (q && q.data) found.push({ text:q.data, fmt:"QR" }); }
            }
          } catch(e) {}
          let added = false;
          for (const f of found) if (f.text && !seenRef.current.some(s=>s.text===f.text)) { seenRef.current.push(f); added = true; }
          if (added) { setSeen(seenRef.current.slice()); if (!firstSeenAt) firstSeenAt = Date.now(); if (navigator.vibrate) navigator.vibrate(30); }
          const hasPN = seenRef.current.some(f => parsePayload(f.text, f.fmt).pns.length);
          if (hasPN) { finish(); return; }
          // a code without a part number (e.g. CAT generic QR): keep looking ~2.5 s for a barcode, then analyse the frame
          if (firstSeenAt && Date.now()-firstSeenAt > 2500) { finish(); return; }
        }
        timer = setTimeout(tick, 120);
      };
      tick();
    })();
    return () => { stopRef.current = true; clearTimeout(timer); streamRef.current && streamRef.current.getTracks().forEach(t=>t.stop()); };
  }, []);

  const toggleTorch = async () => {
    try { const t = streamRef.current.getVideoTracks()[0]; await t.applyConstraints({ advanced:[{ torch: !torch }] }); setTorch(!torch); } catch(e) {}
  };

  return (
    <div className="live">
      <video ref={vRef} playsInline muted autoPlay/>
      <div className="guide"><i/><i/><i/><i/><div className="scanbar"/></div>
      <div className="live-top">
        <button className="lbtn" onClick={onClose}><Icon n="X" size={22}/></button>
        <span>{status}</span>
        <button className="lbtn" onClick={toggleTorch}><Icon n={torch?"FlashlightOff":"Flashlight"} size={20}/></button>
      </div>
      <div className="live-bottom">
        <div className="live-seen">{seen.map((f,i)=><span key={i} className="badge fmt">{f.fmt} ✓</span>)}</div>
        <button className="shutter" onClick={finish} aria-label="صوّر"><i/></button>
        <small>لو الملصق مفيهوش كود، دوس الزرار يصوّر ويقراه بالـAI</small>
      </div>
    </div>);
}

function App() {
  const [tab, setTab] = useState("scan");
  const [apiKey, setApiKey] = useState(()=>LS.get("pw_key",""));
  const sample = useMemo(()=> makeSample(apiKey), [apiKey]);
  const uid = "local";
  const [parts, setParts] = useState([]); const [dbState, setDbState] = useState("loading");
  const [img, setImg] = useState(null), [preview, setPreview] = useState(null);
  const [stage, setStage] = useState(""), [prog, setProg] = useState(0);
  const [codes, setCodes] = useState([]), [ocr, setOcr] = useState(""), [cands, setCands] = useState([]);
  const [pn, setPn] = useState(""), [brandHint, setBrandHint] = useState(null);
  const [manual, setManual] = useState("");
  const [ai, setAi] = useState(null), [aiState, setAiState] = useState(null), [reqState, setReqState] = useState(null);
  const [history, setHistory] = useState([]);
  const [labelBox, setLabelBox] = useState(null);
  const [vision, setVision] = useState(null);
  const [live, setLive] = useState(null); // null | "scan" | "search"
  const [keyDraft, setKeyDraft] = useState(()=>LS.get("pw_key","")), [keyMsg, setKeyMsg] = useState("");
  const exportCSV = () => {
    const rows = [["التاريخ","رقم القطعة","النوع","الماركة","موثّق","الأكواد"]].concat(history.map(h=>[new Date(h.at).toLocaleString("en-GB"), h.pn, h.type||"", h.brand||"", h.verified?"نعم":"لا", (h.codes||[]).join(" | ")]));
    const csv = "\ufeff" + rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = "parts-wizard-history.csv"; a.click();
  };
  const aiCache = useRef({});
  const camRef = useRef(), galRef = useRef(), snapRef = useRef();

  // verified parts DB (data/parts.json in the repo) + local history
  useEffect(() => {
    fetch("data/parts.json", { cache:"no-cache" }).then(r=>r.json()).then(d=>{ setParts(d); setDbState("ok"); })
      .catch(()=>{ setParts(LS.get("pw_parts_cache",[])); setDbState("off"); });
    setHistory(LS.get("pw_history", []));
  }, []);
  useEffect(() => { if (parts.length) LS.set("pw_parts_cache", parts); }, [parts]);
  const addHistory = (h) => setHistory(prev => { const n = [{ id: String(Date.now()), ...h }, ...prev].slice(0, 300); LS.set("pw_history", n); return n; });
  useEffect(() => { ocrProgress = (m) => { if (m.status==="recognizing text") setProg(m.progress); }; }, []);

  const findRec = useCallback((p) => {
    const k = keyOf(p); if (!k) return null;
    return parts.find(r => r.key===k || (r.aliases||[]).map(keyOf).includes(k)) || null;
  }, [parts]);
  const rec = useMemo(()=> findRec(pn), [pn, findRec]);
  const desc = useMemo(()=> vision && vision.description ? { raw:vision.description, ar:vision.typeAr||labelDesc(vision.description)?.ar||"" } : labelDesc(ocr), [ocr, vision]);
  useEffect(() => {
    if (!pn || !sample || stage==="codes" || stage==="ocr" || stage==="vision" || stage==="live" || dbState==="loading") return;
    const k = keyOf(pn);
    if (aiCache.current[k]) { setAi(aiCache.current[k]); return; }
    if (!findRec(pn) || !(findRec(pn).equipment||[]).length || !(findRec(pn).aftermarket||[]).length) doAI();
  }, [pn, sample, stage, dbState]);
  const date = useMemo(()=> labelDate((vision?.dateCode||"") + "\n" + ocr + "\n" + codes.map(c=>c.text).join("\n")), [ocr, codes, vision]);

  async function onFile(e, mode) {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    const im = await loadImage(f);
    analyze(im, mode);
  }
  async function analyze(im, mode, preCodes) {
    reset(true);
    if (mode==="search") { setTab("search"); setManual(""); } else setTab("scan");
    setImg(im); setPreview(im.src);
    setStage("codes");
    const label = findLabel(im); setLabelBox(label);
    let raw = preCodes || [];
    if (!raw.some(c=>parsePayload(c.text, c.fmt).pns.length)) {
      const more = await decodeCodes(im, label);
      const seenT = new Set(raw.map(c=>c.text)); more.forEach(c=>{ if (!seenT.has(c.text)) raw.push(c); });
    }
    const parsed = raw.map(c => ({ ...c, p: parsePayload(c.text, c.fmt) }));
    setCodes(parsed);
    let cs = parsed.flatMap(c=>c.p.pns.map(x=>({...x, brand:x.brand||c.p.brand})));
    const bh = parsed.map(c=>c.p.brand).find(Boolean) || null; setBrandHint(bh);
    const codePN = cs.some(c=>c.src==="code");
    let text = "";
    let canSee = false; try { canSee = !!(sample && sample.limits && (await sample.limits()).images); } catch(e) {}
    if (!codePN && canSee) {
      setStage("vision");
      try {
        const v = await visionRead(sample, im, label); setVision(v);
        text = [v.description, v.text].filter(Boolean).join("\n");
        if (v.partNumber) cs.push({ pn:v.partNumber.toUpperCase().trim(), brand:(BRANDS.find(b=>b.txt.test((v.brand||"").toUpperCase()))||{}).id||bh, src:"vision", strong:true });
        (v.otherNumbers||[]).forEach(o=>o && cs.push({ pn:String(o).toUpperCase().trim(), brand:null, src:"vision" }));
      } catch(e) { console.warn("vision", e); }
    }
    if (!codePN && !cs.length) {
      setStage("ocr"); setProg(0);
      try { text = await runOCR(im, label); } catch(e) { console.warn(e); }
    }
    setOcr(text);
    cs = cs.concat(extractPNs(text, bh, "ocr"));
    const bh2 = bh || (BRANDS.find(b=>b.txt.test(text.toUpperCase()))||{}).id || null; setBrandHint(bh2);
    // rank: code > known in DB > brand-context > ocr
    const uniq = []; const seen = new Set();
    cs.map(c=>({ ...c, score:(c.src==="code"?4:c.src==="vision"?3:0)+(findRec(c.pn)?5:0)+(c.strong?2:0)+(c.brand&&c.brand===bh2?1:0) }))
      .sort((a,b)=>b.score-a.score).forEach(c=>{ const k=keyOf(c.pn); if(!seen.has(k)){ seen.add(k); uniq.push(c);} });
    setCands(uniq);
    if (uniq[0]) { if (mode==="search") setManual(uniq[0].pn); choose(uniq[0].pn, uniq[0].brand || bh2, { codes:parsed, ocr:text }); }
    setStage(uniq[0] ? "done" : (mode==="search" ? "nofind" : "done"));
  }

  async function onLiveDone(blob, codesSeen) {
    const mode = live; setLive(null);
    const im = await loadImage(blob);
    analyze(im, mode, codesSeen);
  }
  function reset(keepTab) { setVision(null); setLabelBox(null); setImg(null); setPreview(null); setCodes([]); setOcr(""); setCands([]); setPn(""); setAi(null); setAiState(null); setReqState(null); setStage(""); setBrandHint(null); if(!keepTab) setManual(""); }

  async function choose(p, b, ctx) {
    setPn(p); setBrandHint(b||null); setAi(null); setAiState(null); setReqState(null);
    {
      const r = findRec(p);
      try { addHistory({ pn:p, brand:b||r?.brand||null, type:r?.typeAr||null, verified:!!r,
        at:Date.now(), codes:(ctx?.codes||codes).map(c=>c.text).slice(0,4) }); } catch(e) {}
    }
  }

  async function doAI() {
    if (!sample) { setAiState("err:البحث بالـAI محتاج مفتاح Claude API. حطه من تاب الإعدادات."); return; }
    if (aiState==="busy") return;
    setAiState("busy");
    try {
      const r = await aiLookup(sample, pn, { brand: brandById(rec?.brand||brandHint)?.name, desc: desc?.raw, label: ocr, codes: codes.map(c=>c.text).join(" | ") });
      const bid = BRANDS.find(b=>b.name.toUpperCase().includes((r.manufacturer||"").toUpperCase().split(" ")[0]))?.id;
      const v = { ...r, brandId: bid }; aiCache.current[keyOf(pn)] = v; setAi(v);
      setAiState(null);
      setHistory(prev => { const n = prev.map((h,i)=> i===0 && keyOf(h.pn)===keyOf(pn) ? { ...h, type: h.type || r.typeAr || null, ai:true } : h); LS.set("pw_history", n); return n; });
    } catch(e) {
      setAiState(e && e.code==="rate_limited" ? "err:اتعمل طلبات كتير ورا بعض. استنى دقيقة وجرّب تاني." :
                 e && e.code==="not_granted" ? "err:لازم توافق على السماح للأداة تسأل Claude." : "err:ماقدرتش أجيب نتيجة. جرّب تاني.");
    }
  }
  async function doRequest() {
    const body = [`رقم القطعة: ${pn}`, `الماركة: ${brandById(brandHint)?.name||"-"}`, codes.length?`الأكواد: ${codes.map(c=>c.text).join(" | ")}`:"", ocr?`نص الملصق:\n${ocr.slice(0,600)}`:"" , ai?`نتيجة AI: ${ai.typeAr||""}`:""].filter(Boolean).join("\n");
    const reqs = LS.get("pw_requests", []); reqs.unshift({ pn, at:Date.now() }); LS.set("pw_requests", reqs.slice(0,200));
    window.open(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent("توثيق: "+pn)}&labels=verify&body=${encodeURIComponent(body)}`, "_blank");
    setReqState("done");
  }

  const busy = stage==="codes" || stage==="ocr" || stage==="vision";
  const showPart = !!pn && !busy;

  return (
    <div className="app">
      <header className="top">
        <div className="logo"><Icon n="ScanLine" size={26}/></div>
        <div><h1>Parts Wizard</h1><p>QR · DataMatrix · باركود · رقم القطعة ← البدائل والمعدات</p></div>
      </header>

      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e)=>onFile(e,"scan")}/>
      <input ref={galRef} type="file" accept="image/*" hidden onChange={(e)=>onFile(e,"scan")}/>
      <input ref={snapRef} type="file" accept="image/*" hidden onChange={(e)=>onFile(e,"search")}/>
      <nav className="tabs">
        {[["scan","Camera","فحص"],["search","Search","بحث"],["hist","History","السجل"],["db","Database","القاعدة"],["set","Settings","الإعدادات"]].map(([k,ic,t])=>(
          <button key={k} className={tab===k?"on":""} onClick={()=>setTab(k)}><Icon n={ic} size={18}/>{t}</button>))}
      </nav>

      {tab==="scan" && <>

        {!preview && <div className="hero">
          <button className="btn y xl" onClick={()=>setLive("scan")}><Icon n="ScanLine" size={26}/> امسح بالكاميرا</button>
          <button className="btn d xl" onClick={()=>galRef.current.click()}><Icon n="ImagePlus" size={24}/> صوّر أو اختار صورة</button>
          <p className="muted" style={{textAlign:"center",margin:0}}>المسح بيقرا الكود أول ما يظهر في الكاميرا، من غير ما تصوّر</p>
          <ul className="tips">
            <li><Icon n="QrCode" size={15}/> بيقرا QR وDataMatrix وAztec وPDF417 والباركود (Code128 / EAN) في نفس الصورة.</li>
            <li><Icon n="FileText" size={15}/> بيقرا رقم القطعة من نص الملصق كمان، عشان أغلب أكواد الـQR على التغليف بتبقى لينك عام.</li>
            <li><Icon n="ShieldCheck" size={15}/> البيانات الموثّقة متعلّم عليها بمصادرها، ونتايج الـAI متعلّم عليها إنها محتاجة مراجعة.</li>
          </ul>
        </div>}
        {preview && <div className="card">
          <div className="prev"><div className="pimg"><img src={preview} alt=""/>
            {labelBox && img && <i className="lbox" style={{left:(labelBox[0]/img.naturalWidth*100)+"%", top:(labelBox[1]/img.naturalHeight*100)+"%", width:(labelBox[2]/img.naturalWidth*100)+"%", height:(labelBox[3]/img.naturalHeight*100)+"%"}}/>}
            {busy && <div className="laser"/>}</div></div>
          <div className="row2">
            <button className="btn d" disabled={busy} onClick={()=>galRef.current.click()}><Icon n="Camera" size={18}/> صورة جديدة</button>
            <button className="btn ghost" disabled={busy} onClick={()=>reset()}><Icon n="Trash2" size={18}/></button>
          </div>
          {busy && <div className="stage"><Icon n="Loader2" size={16} className="spin"/> {stage==="codes"?"بيدوّر على الأكواد…":stage==="vision"?"Claude بيقرا الملصق…":"بيقرا نص الملصق… "+Math.round(prog*100)+"%"}
            {stage==="ocr" && <div className="bar"><i style={{width:prog*100+"%"}}/></div>}</div>}
        </div>}

        {!busy && preview && <>
          <Section icon="QrCode" title={`الأكواد المقروءة (${codes.length})`}>
            {codes.length===0 && <p className="muted">مالقيتش QR ولا باركود. قرّب الكاميرا على الكود، وخلّيه واضح ومن غير لمعة.</p>}
            {codes.map((c,i)=><CodeCard key={i} c={c}/>)}
          </Section>
          <Section icon="Hash" title="أرقام القطع المكتشفة">
            {cands.length===0 && <p className="muted">مالقيتش رقم قطعة. اكتبه في تبويب "بحث برقم".</p>}
            <div className="cands">{cands.slice(0,8).map((c,i)=>(
              <button key={i} className={"cand "+(keyOf(c.pn)===keyOf(pn)?"on":"")} onClick={()=>choose(c.pn, c.brand)}>
                <code dir="ltr">{c.pn}</code><small>{c.brand&&brandById(c.brand)?brandById(c.brand).name:""} · {c.src==="code"?"من الكود":c.src==="vision"?"قراءة ذكية":"من النص"}{findRec(c.pn)?" · موثّق":""}</small>
              </button>))}</div>
            {ocr && <details className="ocr"><summary>نص الملصق المقروء</summary><pre dir="ltr">{ocr}</pre></details>}
          </Section>
        </>}
        {showPart && <PartView pn={pn} brandHint={brandHint} rec={rec} ai={ai} aiState={aiState} onAI={doAI} onRequest={doRequest} reqState={reqState} ocrText={ocr} date={date} desc={desc}/>}
      </>}

      {tab==="search" && <>
        <div className="card">
          <form onSubmit={(e)=>{e.preventDefault(); const v=manual.trim(); if(!v) return;
              const c = extractPNs(v, null, "manual"); const b = c[0]?.brand || (BRANDS.find(b=>b.txt.test(v.toUpperCase()))||{}).id || null;
              setCodes([]); setOcr(""); choose(c[0]?.pn || v.toUpperCase(), b); }}>
            <div className="sbox"><input dir="ltr" value={manual} onChange={e=>setManual(e.target.value.toUpperCase())}
              placeholder="1R-1808 · 207-60-71182 · P551808 · LF9018" autoCapitalize="characters" spellCheck={false}/>
              <button type="button" className="btn d snap" title="امسح بالكاميرا" onClick={()=>setLive("search")}><Icon n="Camera" size={20}/></button>
              <button className="btn y"><Icon n="Search" size={18}/> بحث</button></div>
          </form>
          {busy && tab==="search" && <div className="stage"><Icon n="Loader2" size={16} className="spin"/> {stage==="codes"?"بيدوّر على الأكواد…":stage==="vision"?"Claude بيقرا رقم القطعة من الصورة…":"بيقرا النص… "+Math.round(prog*100)+"%"}</div>}
          {stage==="nofind" && tab==="search" && <p className="note bad">مالقيتش رقم قطعة في الصورة. قرّب الكاميرا على الرقم، أو اكتبه.</p>}
          {!busy && !pn && <p className="muted" style={{marginTop:8}}><Icon n="Camera" size={13}/> دوس الكاميرا ووجّهها على رقم القطعة أو الملصق، والبحث هيبدأ لوحده. <button type="button" className="mini" onClick={()=>snapRef.current.click()}>أو اختار صورة</button></p>}
          <div className="quick">{parts.slice(0,12).map(p=><button key={p.id} onClick={()=>{setManual(p.pn); setCodes([]); setOcr(""); choose(p.pn, p.brand);}} dir="ltr">{p.pn}</button>)}</div>
        </div>
        {pn && !busy && <PartView pn={pn} brandHint={brandHint} rec={rec} ai={ai} aiState={aiState} onAI={doAI} onRequest={doRequest} reqState={reqState} date={date} desc={desc}/>}
      </>}

      {tab==="hist" && <div className="card">
        {history.length>0 && <button className="btn d" style={{width:"100%",marginBottom:8}} onClick={exportCSV}><Icon n="Download" size={18}/> تصدير السجل (Excel / CSV)</button>}
        {uid && history.length===0 && <p className="muted">لسه مفيش فحوصات.</p>}
        {history.map(h=>(
          <button key={h.id} className="hrow" onClick={()=>{ setTab("search"); setManual(h.pn); setCodes([]); setOcr(""); setPn(h.pn); setBrandHint(h.brand); setAi(null); }}>
            <code dir="ltr">{h.pn}</code>
            <span>{h.type || (h.brand && brandById(h.brand)?.name) || ""}</span>
            {h.verified ? <Badge kind="ok">موثّق</Badge> : h.ai ? <Badge kind="warn">AI</Badge> : null}
            <small>{new Date(h.at).toLocaleString("ar-EG",{dateStyle:"short",timeStyle:"short"})}</small>
          </button>))}
      </div>}

      {tab==="db" && <div className="card">
        <p className="muted">{dbState==="ok"?`القاعدة الموثّقة فيها ${parts.length} قطعة، كل رقم متسجّل معاه مصدره.`:dbState==="off"?"القاعدة مش متاحة في العرض ده.":dbState==="slow"?"القاعدة لسه بتحمّل…":"بيحمّل…"}</p>
        {parts.map(p=>(
          <button key={p.id} className="hrow" onClick={()=>{ setTab("search"); setManual(p.pn); setCodes([]); setOcr(""); choose(p.pn, p.brand); }}>
            <code dir="ltr">{p.pn}</code><span>{p.typeAr}</span><Badge kind={brandById(p.brand)?.oem?"oem":"am"}>{brandById(p.brand)?.name||p.brand}</Badge>
            <small>{(p.aftermarket||[]).length} بديل</small>
          </button>))}
        <p className="disc"><Icon n="Info" size={14}/> أي رقم مش موجود هنا، دوس "اطلب توثيق" من صفحته، وهيتراجع ويتضاف للقاعدة بمصادره.</p>
      </div>}

      {tab==="set" && <div className="card">
        <h3 style={{marginTop:0}}>مفتاح Claude API</h3>
        <p className="muted">القراءة الذكية للملصقات والبحث عن البدائل والمعدات محتاجين مفتاح من console.anthropic.com. المسح والقاعدة الموثّقة شغالين من غيره. المفتاح بيتحفظ على الموبايل ده بس.</p>
        <div className="sbox"><input dir="ltr" type="password" value={keyDraft} onChange={e=>setKeyDraft(e.target.value.trim())} placeholder="sk-ant-..." autoComplete="off"/>
          <button className="btn y" onClick={()=>{ LS.set("pw_key", keyDraft); setApiKey(keyDraft); setKeyMsg(keyDraft?"اتحفظ ✓":"اتمسح"); }}>حفظ</button></div>
        {keyMsg && <p className="muted">{keyMsg}</p>}
        <p className="muted">الحالة: {apiKey ? "✅ القراءة الذكية مفعّلة" : "⚪ القراءة الذكية مش مفعّلة"}</p>
        <a className="links-a" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener"><Icon n="ExternalLink" size={14}/> اعمل مفتاح من Anthropic Console</a>
        <h3>طلبات التوثيق</h3>
        <p className="muted">زرار "اطلب توثيق" بيفتح طلب على GitHub بالرقم وبيانات الملصق، وبيتراجع ويتضاف للقاعدة بمصادره.</p>
        <a className="links-a" href={`https://github.com/${REPO}/issues`} target="_blank" rel="noopener"><Icon n="ExternalLink" size={14}/> الطلبات المفتوحة</a>
        <h3>عن التطبيق</h3>
        <p className="muted">Parts Wizard · القاعدة الموثّقة فيها {parts.length} قطعة · كل الأكواد والصور بتتقري على الموبايل نفسه.</p>
      </div>}

      {(tab==="scan"||tab==="search") && !busy && !live && (preview || pn) && <button className="fab" onClick={()=>setLive(tab==="search"?"search":"scan")}><Icon n="ScanLine" size={22}/> {tab==="search"?"امسح رقم تاني":"فحص التالي"}</button>}
      {live && <LiveScanner onDone={onLiveDone} onClose={()=>setLive(null)}/>}
      <footer>Parts Wizard · البدائل لازم تتطابق مع المقاسات والسيريال قبل الطلب</footer>
    </div>);
}

class Boundary extends React.Component {
  constructor(p){ super(p); this.state={err:null}; }
  static getDerivedStateFromError(err){ return {err}; }
  render(){ if (this.state.err) return (
    <div className="card" style={{margin:16}}><h3 style={{color:"#fca5a5"}}>حصل خطأ في الأداة</h3>
      <p className="muted">صوّر الشاشة دي وابعتهالي:</p><pre dir="ltr">{String(this.state.err && (this.state.err.stack||this.state.err.message||this.state.err)).slice(0,800)}</pre>
      <button className="btn y" onClick={()=>this.setState({err:null})}>رجوع</button></div>);
    return this.props.children; }
}
ReactDOM.createRoot(document.getElementById("root")).render(<Boundary><App/></Boundary>);
window.__appStarted = true;
