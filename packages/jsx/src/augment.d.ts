import 'estree';

// very important because the AST from @sveltejs/acorn-typescript doesn't agree with @types/estree-jsx
declare module 'estree' {
    interface BaseNodeWithoutComments {
        start: number;
        end: number;
    }
}
