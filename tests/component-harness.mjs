import fs from 'node:fs';
import vm from 'node:vm';
export function makeDemo(){
 const context={DCLogic:class {constructor(props){this.props=props}setState(next){this.state=next}}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(new URL('../demo/index.html',import.meta.url),'utf8').match(/<script\b[^>]*type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1]+'\nthis.DemoComponent=Component;',context);
 return new context.DemoComponent({accent:'#E00000',showDemoBar:true});
}
