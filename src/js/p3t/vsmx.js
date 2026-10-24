// PS3 dynamic theme player: vsmx. Adapted from DeckyXMB (src/dynamic/vsmx.ts),
// Copyright (c) Callum Bell, BSD 3-Clause License (see README.md, Credits).
// A small interpreter for VSMX, the compiled JavaScript PS3 dynamic themes use to
// direct their scene (which actor shows when, timers, the camera's aspect).
// Opcode numbering follows RCOMage's VSMX tools; only what theme scripts use is
// implemented, and anything else stops the script (the scene keeps its last state).
const OP = {
    ASSIGN: 0x01, ADD: 0x02, SUB: 0x03, MUL: 0x04, DIV: 0x05, MOD: 0x06, POS: 0x07, NEG: 0x08, NOT: 0x09,
    PRE_INC: 0x0a, PRE_DEC: 0x0b, INC: 0x0c, DEC: 0x0d,
    EQ: 0x0e, NE: 0x0f, SEQ: 0x10, SNE: 0x11, LT: 0x12, LE: 0x13, GE: 0x14, GT: 0x15,
    B_AND: 0x19, B_XOR: 0x1a, B_OR: 0x1b, B_NOT: 0x1c, SHL: 0x1d, SHR: 0x1e, USHR: 0x1f,
    DUP: 0x20, SWAP: 0x21, END_STMT: 0x22, UNDEFINED: 0x23, NULL: 0x24, BOOL: 0x25, INT: 0x26, FLOAT: 0x27, STRING: 0x28,
    OBJECT: 0x29, FUNCTION: 0x2a, ARRAY: 0x2b, // [a, b]: ARRAY, then ARRAY_PUSH for each element
    THIS: 0x2c, LOCAL: 0x2d, NAME: 0x2e, PROPERTY: 0x2f, METHOD: 0x30, SET: 0x31,
    ADD_PROPERTY: 0x33, // an object literal's property: { prop: value }, the object stays on the stack
    ARRAY_INDEX: 0x34, ARRAY_INDEX_ASSIGN: 0x36, DELETE: 0x37, ARRAY_PUSH: 0x38, JUMP: 0x39, JUMP_TRUE: 0x3a, JUMP_FALSE: 0x3b,
    CALL_FUNCTION: 0x3c, CALL_METHOD: 0x3d, CALL_NEW: 0x3e, RETURN: 0x3f,
    // try { … } catch (e) { … }: TRY (its catch at arg), TRY_END, then CATCH (normally jumps past the catch block to arg), CATCH_END
    THROW: 0x40, TRY: 0x41, TRY_END: 0x42, CATCH: 0x43, CATCH_END: 0x44,
    END: 0x45, DEBUG_FILE: 0x46, DEBUG_LINE: 0x47,
    ARRAY_INDEX_KEEP: 0x48, // (PS3) a[i] += x: a[i]'s value, a and i kept for the ARRAY_INDEX_ASSIGN that follows
    FLOAT_ARRAY: 0x49,
    GET_ELEMENT: 0x4a, // (PS3) element n (high byte) of the vector on top
    GET_VAR_ELEMENT: 0x4b, // (PS3) v[n] += x on a variable: element n of the vector in it, the variable kept for SET_VAR_ELEMENT
    SET_VAR_ELEMENT: 0x4c, // (PS3) variable v[n] = value (PixelJunk Shooter 2 turns its gears so)
    SET_ELEMENT: 0x4d, // (PS3) obj.prop[n] = value
};
const NEXT = -1;
const RETURN = -2;
/** An assignable place: a global, an object's property or an array element. */
class Ref {
    constructor(obj, key) {
        this.obj = obj;
        this.key = key;
    }
    get() {
        return this.obj?.[this.key];
    }
    set(v) {
        this.obj[this.key] = v;
    }
}
class Method {
    constructor(obj, key) {
        this.obj = obj;
        this.key = key;
    }
}
class Func {
    constructor(vm, entry) {
        this.vm = vm;
        this.entry = entry;
    }
}
const val = (x) => (x instanceof Ref ? x.get() : x);
const same = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6) : a == b;
export class Vsmx {
    constructor(bytes, globals) {
        this.globals = globals;
        this.code = [];
        this.text = [];
        this.props = [];
        this.names = [];
        /** Something the script needs that isn’t here: it carries on without it (as the PS3 would, more or less), but says so, once. */
        this.missing = new Set();
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u = (o) => dv.getUint32(o, true);
        if (String.fromCharCode(...bytes.subarray(0, 4)) !== "VSMX")
            throw new Error("not a VSMX script");
        const [co, cl, to, tl, , po, pl, , no, nl] = [u(8), u(12), u(16), u(20), u(24), u(28), u(32), u(36), u(40), u(44)];
        for (let i = 0; i < cl / 8; i++)
            this.code.push({ op: u(co + 8 * i), arg: u(co + 8 * i + 4) });
        this.text = table(bytes.subarray(to, to + tl));
        this.props = table(bytes.subarray(po, po + pl));
        this.names = table(bytes.subarray(no, no + nl));
    }
    run() {
        this.exec(0, undefined);
    }
    call(f, self, args) {
        return this.exec(f.entry, self, args);
    }
    exec(pc, self, args = []) {
        const st = [];
        const locals = [undefined, ...args]; // numbered from 1: a function's arguments, then its own variables
        const pop = () => val(st.pop());
        const popN = (n) => st.splice(st.length - n, n).map(val);
        const f32 = new DataView(new ArrayBuffer(4));
        const tries = []; // the try blocks we're in: where their catch is, and the stack then
        for (let guard = 0; guard < 200000; guard++) {
            const c = this.code[pc++];
            if (!c)
                return undefined;
            try {
                const to = this.step(c, st, locals, self, f32, tries, pop, popN);
                if (to === RETURN)
                    return this.result;
                if (to !== NEXT)
                    pc = to;
            }
            catch (e) {
                // Thrown inside a try: on to its catch block, which takes the error off the stack.
                const t = tries.pop();
                if (!t)
                    throw e;
                st.length = t.depth;
                st.push(e);
                pc = t.at + 1;
            }
        }
        throw new Error("VSMX script ran too long");
    }
    /** One instruction: NEXT (on to the next), where to jump to, or RETURN. */
    step(c, st, locals, self, f32, tries, pop, popN) {
        const a = c.arg;
        switch (c.op & 0xff) {
            case OP.TRY:
                tries.push({ at: a, depth: st.length });
                break;
            case OP.TRY_END:
                tries.pop();
                break;
            case OP.CATCH:
                return a; // reached without an error: past the catch block
            case OP.CATCH_END:
                break;
            case OP.THROW:
                throw pop();
            case OP.SWAP: {
                const x = st.pop();
                const y = st.pop();
                st.push(x, y);
                break;
            }
            case OP.DELETE: {
                const i = pop();
                const o = pop();
                st.push(o != null ? delete o[i] : true);
                break;
            }
            case OP.NAME: {
                const n = this.names[a];
                st.push(new Ref(this.globals, n));
                break;
            }
            case OP.LOCAL:
                st.push(new Ref(locals, a));
                break;
            case OP.GET_ELEMENT: {
                // Element n of the vector on top. Loaded as obj.method (the read-modify-write form,
                // obj.v[n] += x), the vector stays for the SET_ELEMENT that follows; otherwise it's replaced.
                const top = st[st.length - 1];
                if (top instanceof Method)
                    st.push(top.obj?.[top.key]?.[c.op >>> 8]);
                else
                    st[st.length - 1] = val(top)?.[c.op >>> 8];
                break;
            }
            case OP.GET_VAR_ELEMENT:
                st.push(val(st[st.length - 1])?.[c.op >>> 8]);
                break;
            case OP.SET_VAR_ELEMENT: {
                const v = pop();
                const r = st.pop();
                const old = val(r);
                const vec = Array.isArray(old) ? [...old] : [0, 0, 0];
                vec[c.op >>> 8] = v;
                if (r instanceof Ref)
                    r.set(vec);
                st.push(v);
                break;
            }
            case OP.SET_ELEMENT: {
                const v = pop();
                const target = st.pop();
                const o = target instanceof Method ? target.obj : val(target);
                const key = this.props[a];
                const vec = Array.isArray(o?.[key]) ? [...o[key]] : [0, 0, 0];
                vec[c.op >>> 8] = v;
                o[key] = vec;
                st.push(v);
                break;
            }
            case OP.PROPERTY:
                st.push(new Ref(pop(), this.props[a]));
                break;
            case OP.METHOD:
                st.push(new Method(pop(), this.props[a]));
                break;
            case OP.SET: {
                const v = pop();
                const o = pop();
                o[this.props[a]] = v;
                st.push(v);
                break;
            }
            case OP.ADD_PROPERTY: {
                const v = pop();
                const o = val(st[st.length - 1]);
                if (o != null)
                    o[this.props[a]] = v;
                break;
            }
            case OP.ASSIGN: {
                const v = pop();
                const r = st.pop();
                if (r instanceof Ref)
                    r.set(v);
                st.push(v);
                break;
            }
            case OP.ARRAY_INDEX_ASSIGN: {
                const v = pop();
                const i = pop();
                const o = pop();
                o[i] = v;
                st.push(v);
                break;
            }
            case OP.ARRAY_INDEX_KEEP:
                st.push(val(st[st.length - 2])?.[val(st[st.length - 1])]);
                break;
            case OP.ARRAY_INDEX: {
                const i = pop();
                st.push(new Ref(pop(), i));
                break;
            }
            case OP.UNDEFINED:
                st.push(undefined);
                break;
            case OP.NULL:
                st.push(null);
                break;
            case OP.OBJECT:
                st.push({});
                break;
            case OP.ARRAY:
                st.push([]);
                break;
            case OP.ARRAY_PUSH: {
                const v = pop();
                val(st[st.length - 1])?.push?.(v);
                break;
            }
            case OP.BOOL:
                st.push(a !== 0);
                break;
            case OP.INT:
                st.push(a | 0);
                break;
            case OP.FLOAT:
                f32.setUint32(0, a);
                st.push(f32.getFloat32(0));
                break;
            case OP.STRING:
                st.push(this.text[a]);
                break;
            case OP.THIS:
                st.push(self);
                break;
            case OP.FLOAT_ARRAY:
                st.push(popN(a).map(Number));
                break;
            case OP.FUNCTION:
                st.push(new Func(this, a));
                break;
            case OP.CALL_FUNCTION: {
                const args = popN(a);
                const f = pop();
                st.push(this.invoke(f, undefined, args));
                break;
            }
            case OP.CALL_METHOD: {
                const args = popN(a);
                const m = st.pop();
                if (m instanceof Method && m.obj != null && !this.callable(m.obj[m.key]))
                    this.unsupported(m.key + "()");
                st.push(m instanceof Method ? this.invoke(m.obj?.[m.key], m.obj, args) : undefined);
                break;
            }
            case OP.CALL_NEW: {
                const args = popN(a);
                const named = st[st.length - 1];
                const C = pop();
                if (!this.callable(C))
                    this.unsupported("new " + (named instanceof Ref ? named.key : "?"));
                if (C instanceof Func) {
                    // A constructor the script defines (function Thing() { this.x = ... }): run it on a new object.
                    const obj = {};
                    const r = C.vm.call(C, obj, args);
                    st.push(r !== null && typeof r === "object" ? r : obj);
                }
                else
                    st.push(typeof C === "function" ? new C(...args) : undefined);
                break;
            }
            case OP.DUP:
                st.push(st[st.length - 1]);
                break;
            case OP.END_STMT:
                st.pop();
                break;
            case OP.JUMP:
                return a;
            case OP.JUMP_TRUE:
                return pop() ? a : NEXT;
            case OP.JUMP_FALSE:
                return pop() ? NEXT : a;
            case OP.RETURN:
                this.result = pop();
                return RETURN;
            case OP.END:
                this.result = undefined;
                return RETURN;
            case OP.DEBUG_FILE:
            case OP.DEBUG_LINE:
                break;
            case OP.NOT:
                st.push(!pop());
                break;
            case OP.NEG:
                st.push(-pop());
                break;
            case OP.POS:
                st.push(+pop());
                break;
            case OP.B_NOT:
                st.push(~pop());
                break;
            case OP.PRE_INC:
            case OP.PRE_DEC:
            case OP.INC:
            case OP.DEC: {
                const r = st.pop();
                const old = Number(r.get());
                const now = c.op === OP.PRE_INC || c.op === OP.INC ? old + 1 : old - 1;
                r.set(now);
                st.push(c.op === OP.PRE_INC || c.op === OP.PRE_DEC ? now : old);
                break;
            }
            default: {
                const r = pop();
                const l = st.pop();
                // obj.prop += x: loaded as obj.method, so obj stays for the SET that follows.
                if (l instanceof Method)
                    st.push(l.obj, binary(c.op & 0xff, l.obj?.[l.key], r));
                else
                    st.push(binary(c.op & 0xff, val(l), r));
            }
        }
        return NEXT;
    }
    callable(f) {
        return f instanceof Func || typeof f === "function";
    }
    unsupported(what) {
        if (this.missing.has(what))
            return;
        this.missing.add(what);
        console.warn("p3t: theme script uses unsupported", what);
    }
    invoke(f, self, args) {
        if (f instanceof Func)
            return f.vm.call(f, self, args);
        if (typeof f === "function")
            return f.apply(self, args);
        return undefined;
    }
}
/** Arithmetic on vectors (colours, positions) as PS3 scripts allow: element by element, a number applying to every element. */
function vec(l, r, f) {
    if (!Array.isArray(l) && !Array.isArray(r))
        return f(l, r);
    const n = Array.isArray(l) ? l.length : r.length;
    return Array.from({ length: n }, (_, i) => f(Array.isArray(l) ? l[i] : l, Array.isArray(r) ? r[i] : r));
}
// Arithmetic is in single precision, as on the PS3: scripts time things with sums that come out a hair over in double
// precision (MotorStorm's 200 × (30 / 24) / 30 seconds is 250.00000000000003 frames, and its snowmobile drove a frame
// too long each time, its animation wrapping a frame further round every lap).
const f32 = Math.fround;
function binary(op, l, r) {
    switch (op) {
        case OP.ADD: return typeof l === "string" || typeof r === "string" ? l + r : vec(l, r, (a, b) => f32(a + b));
        case OP.SUB: return vec(l, r, (a, b) => f32(a - b));
        case OP.MUL: return vec(l, r, (a, b) => f32(a * b));
        case OP.DIV: return vec(l, r, (a, b) => f32(a / b));
        case OP.MOD: return f32(l % r);
        case OP.EQ:
        case OP.SEQ: return same(l, r);
        case OP.NE:
        case OP.SNE: return !same(l, r);
        case OP.LT: return l < r;
        case OP.LE: return l <= r;
        case OP.GE: return l >= r;
        case OP.GT: return l > r;
        case OP.B_AND: return l & r;
        case OP.B_XOR: return l ^ r;
        case OP.B_OR: return l | r;
        case OP.SHL: return l << r;
        case OP.SHR: return l >> r;
        case OP.USHR: return l >>> r;
    }
    throw new Error(`unsupported VSMX opcode ${op}`);
}
/** A string table: UTF-16 or (in PS3 scripts' name tables) 8-bit, NUL-separated. */
function table(b) {
    const wide = b.length > 1 && b[1] === 0;
    const out = [];
    let s = "";
    for (let i = 0; i < b.length; i += wide ? 2 : 1) {
        const c = wide ? b[i] | (b[i + 1] << 8) : b[i];
        if (c === 0) {
            out.push(s);
            s = "";
        }
        else
            s += String.fromCharCode(c);
    }
    if (s)
        out.push(s);
    return out;
}
