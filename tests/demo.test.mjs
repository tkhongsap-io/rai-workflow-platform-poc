import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo} from './component-harness.mjs';
const event=value=>({target:{value},preventDefault(){}});
const role=(a,key)=>a.renderVals().roleTabs.find(r=>r.key===key).on();
const open=a=>a.renderVals().qCards[0].open();
const submit=a=>{a.renderVals().onSubmit();a.renderVals().onModalPrimary()};
const first=a=>a.state.cases[0];
const prepare=()=>{const a=makeDemo();open(a);submit(a);return a};
const lane=(a,key)=>a.renderVals().laneCards.find(l=>l.name===a.laneOf(key).name);
const approve=(a,key)=>{role(a,key);lane(a,key).onApprove();a.renderVals().onModalPrimary()};
test('initial queue scopes owner and SPOC cases and filter options',()=>{
 const a=makeDemo();for(const r of ['owner','spoc']){role(a,r);const v=a.renderVals();assert.equal(v.qCards.length,1);assert.equal(v.filters.find(f=>f.id==='f-bu').opts.length,2);assert.doesNotMatch(v.queueCountLine,/desk overall/)}
 role(a,'coe');assert.equal(a.renderVals().qCards.length,2);
});
test('new-case validation preserves input and supports Unknown/nonvendor defaults',()=>{
 const a=makeDemo();a.renderVals().onNew();a.renderVals().nc.onCreate();assert.equal(a.state.cases.length,2);assert.equal(a.renderVals().nc.nameErr,true);
 a.renderVals().nc.onName(event('Synthetic review demo'));a.renderVals().nc.srcModes[1].on();a.renderVals().nc.onCreate();const k=a.state.cases.at(-1);assert.equal(k.src,'Unknown');assert.equal(k.docs.dpa.state,'na');assert.ok(k.docs.dpa.reason.length>10);assert.equal(Object.keys(k.docs).length,9);
});
test('SPOC submission attributes actor and opens all lanes despite findings',()=>{
 const a=makeDemo();role(a,'spoc');open(a);submit(a);const k=first(a);assert.equal(k.state,'in_review');assert.equal(k.snaps[0].by,'Suchada P.');assert.equal(k.findings.length,3);assert.ok(Object.values(k.lanes).every(l=>l.state==='open'));
});
test('lane UI exposes own actions only; Admin never gains approval authority',()=>{
 const a=prepare();for(const r of ['coe','dpo','sec','owner','spoc','admin']){role(a,r);const actions=a.renderVals().laneCards.filter(l=>l.actionable);assert.equal(actions.length,['coe','dpo','sec'].includes(r)?1:0)}
});
test('sendback requires artifact and specific feedback and preserves snapshot',()=>{
 const a=prepare();const frozen=JSON.stringify(first(a).snaps[0]);role(a,'coe');lane(a,'coe').onSendBack();a.renderVals().onModalPrimary();assert.equal(first(a).ver,1);assert.equal(a.renderVals().sb.slotErr,true);
 a.renderVals().sb.onSlot(event('brd'));a.renderVals().sb.onText(event('Replace BRD with corrected metric and evaluation evidence.'));a.renderVals().onModalPrimary();assert.equal(first(a).ver,2);assert.equal(first(a).state,'changes_requested');assert.equal(JSON.stringify(first(a).snaps[0]),frozen);assert.equal(first(a).decisions[0].ver,1);assert.equal(first(a).decisions[0].kind,'sent_back');
});
test('resubmission does not carry previous approvals',()=>{
 const a=prepare();approve(a,'dpo');a.sendBack(a.state,first(a),'coe','brd','Correct the evidence before resubmitting.');role(a,'owner');submit(a);assert.ok(Object.values(first(a).lanes).every(l=>l.state==='open'&&l.ver===2));assert.equal(first(a).snaps.length,2);
});
test('three approvals do not imply Ready while findings remain',()=>{
 const a=prepare();for(const r of ['coe','dpo','sec'])approve(a,r);assert.equal(first(a).state,'awaiting_disposition');assert.ok(a.openFindings(first(a))>0);
 for(const f of a.curFindings(first(a)))a.disposeFinding(a.state,first(a),f.id,'waived','Synthetic demonstration disposition with rationale.','');assert.equal(first(a).state,'ready');assert.equal(a.state.notifs.filter(n=>n.kind==='done').length,1);a.refresh(a.state,first(a));assert.equal(a.state.notifs.filter(n=>n.kind==='done').length,1);
});
test('stale-version approvals cannot satisfy current completion predicate',()=>{
 const a=prepare();const k=first(a);for(const l of Object.values(k.lanes)){l.state='approved';l.ver=0}k.findings=[];a.refresh(a.state,k);assert.equal(k.state,'in_review');
});
test('QC repeated preview does not duplicate current-version findings',()=>{
 const a=prepare();const k=first(a);const n=k.findings.length;const result=a.runQC(a.state,k,'repeat',null);assert.equal(result.created.length,0);assert.equal(k.findings.length,n);
});
test('approval summary counts already recorded flags',()=>{
 const a=prepare();role(a,'dpo');lane(a,'dpo').onApprove();assert.match(a.renderVals().qc.summaryTitle,/already recorded/);assert.doesNotMatch(a.renderVals().qc.summaryTitle,/Nothing flagged/);
});
test('QC unavailability becomes explicit findings in each lane',()=>{
 const a=makeDemo();a.state=a.build('s4');open(a);a.renderVals().onSubmit();assert.equal(a.renderVals().qc.down,true);assert.match(a.renderVals().qc.summaryTitle,/No clean pass/);a.renderVals().onModalPrimary();assert.equal(first(a).findings.length,3);assert.ok(first(a).findings.every(f=>/unavailable/i.test(f.title)));
});
test('checklist version selects threshold source independently of model version',()=>{
 const a=makeDemo();for(const mv of ['1.0','2.0']){const s=a.build('s1'),k=s.cases[0];k.modelVer=mv;let q=a.runQC(s,k,'test',null);assert.ok(q.checks.some(c=>c.label==='SL2.1 threshold provenance'));k.checklistVer='v2.0';q=a.runQC(s,k,'test',null);assert.ok(q.checks.some(c=>c.label==='SL2.1 threshold isolation'));assert.ok(!q.checks.some(c=>c.label==='SL2.1 threshold provenance'))}
});
test('published config leaves frozen submitted snapshot unchanged',()=>{
 const a=prepare(),frozen=JSON.stringify(first(a).snaps[0]);role(a,'admin');a.renderVals().onNavAdmin();a.renderVals().ad.onTpl(event('1.5'));const ad=a.renderVals().ad;assert.equal(typeof ad.onPublish,'function');ad.onPublish();assert.equal(a.state.config.rev,4);assert.equal(first(a).cfg.rev,3);assert.equal(JSON.stringify(first(a).snaps[0]),frozen);
});
test('preview width switches preserve case state',()=>{
 const a=prepare();const original=JSON.stringify(a.state.cases);for(const width of ['834','390','1440']){a.renderVals().vwTabs.find(v=>v.label===width).on();assert.equal(JSON.stringify(a.state.cases),original);assert.match(a.renderVals().frameStyle,new RegExp('width:'+width+'px'))}
});
test('filters produce no-match and reset returns deterministic state',()=>{
 const a=makeDemo();a.renderVals().onSearch(event('does-not-exist'));assert.equal(a.renderVals().qNoMatch,true);a.renderVals().onClearFilters();assert.equal(a.renderVals().qCards.length,1);open(a);submit(a);a.renderVals().onReset();assert.equal(first(a).state,'draft');assert.equal(first(a).findings.length,0);assert.equal(a.state.role,'owner');
});
test('disposition dialog rejects missing evidence and empty waiver reason',()=>{
 const a=prepare();role(a,'dpo');a.renderVals().findRows.find(f=>f.lane==='Privacy (DPO)').onDispose();a.renderVals().onModalPrimary();assert.equal(a.renderVals().dp.evErr,true);assert.equal(a.renderVals().dp.reasonErr,true);
 a.renderVals().dp.kinds.find(k=>k.v==='waived').on();a.renderVals().onModalPrimary();assert.equal(a.renderVals().dp.reasonErr,true);a.renderVals().dp.onReason(event('Synthetic demonstration acceptance with clear rationale.'));a.renderVals().onModalPrimary();assert.equal(first(a).findings.find(f=>f.lane==='dpo').disp.kind,'waived');
});
test('risk remains provisional and submitted evidence cannot change tier',()=>{
 const a=prepare();const prior=first(a).riskScenario;a.renderVals().onRisk();assert.equal(a.renderVals().rk.locked,true);a.renderVals().rk.opts.find(o=>o.v==='high').on();assert.equal(first(a).riskScenario,prior);
});
test('Admin rejects invalid configuration without changing the live revision',()=>{
 const a=makeDemo();role(a,'admin');a.renderVals().onNavAdmin();
 const live=JSON.stringify(a.state.config);
 const invalid=[{tpl:' '},{slaDpo:-1},{slaOther:0},{slaDpo:1.5},{slaDpo:''},{hi:0},{hi:NaN},{lo:101},{hi:3},{md:3},{hi:-1}];
 for(const changes of invalid){
  a.state.cfgDraft={...a.state.config,...changes};
  assert.equal(a.renderVals().ad.publishDisabled,true,JSON.stringify(changes));
  assert.equal(a.renderVals().ad.discardDisabled,false);
  a.renderVals().ad.onPublish();assert.equal(JSON.stringify(a.state.config),live);
 }
 a.state.cfgDraft={...a.state.config,tpl:'1.5',slaDpo:4,hi:0.5};
 assert.equal(a.renderVals().ad.publishDisabled,false);a.renderVals().ad.onPublish();
 assert.equal(a.state.config.rev,4);assert.equal(a.state.config.slaDpo,4);
});
test('non-Admin cannot publish even through a stale Admin callback',()=>{
 const a=makeDemo();role(a,'admin');a.renderVals().ad.onTpl(event('1.5'));
 const publish=a.renderVals().ad.onPublish;role(a,'owner');publish();assert.equal(a.state.config.rev,3);
});

test('discard recovers valid config after an invalid edit',()=>{
 const a=makeDemo();role(a,'admin');a.renderVals().ad.onSlaDpo(event('-1'));
 assert.equal(a.renderVals().ad.discardDisabled,false);a.renderVals().ad.onRevert();
 assert.equal(a.renderVals().ad.slaDpo,'3');assert.equal(a.renderVals().ad.discardDisabled,true);assert.equal(a.state.config.rev,3);
});
