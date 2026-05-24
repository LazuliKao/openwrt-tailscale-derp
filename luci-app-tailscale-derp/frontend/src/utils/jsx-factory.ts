type PrimitiveChild = string | number;
type ChildValue = PrimitiveChild | Node | null | undefined | boolean | ChildValue[];
type Props = Record<string, unknown> & {
  children?: ChildValue | ChildValue[];
};
type Component = (props: Props) => Node;
type TagName = string | Component | typeof Fragment;

const fragmentMarker = Symbol("Fragment");

export const Fragment = fragmentMarker;

function isNode(value: unknown): value is Node {
  return value instanceof Node;
}

function isEventHandler(value: unknown): value is EventListener {
  return typeof value === "function";
}

function normalizeChildren(input: ChildValue | ChildValue[]): Array<Node | PrimitiveChild> {
  const queue = Array.isArray(input) ? input : [input];
  const result: Array<Node | PrimitiveChild> = [];

  for (const item of queue) {
    if (Array.isArray(item)) {
      result.push(...normalizeChildren(item));
      continue;
    }

    if (item == null || typeof item === "boolean") {
      continue;
    }

    if (isNode(item) || typeof item === "string" || typeof item === "number") {
      result.push(item);
    }
  }

  return result;
}

function toDomChildren(children: Array<Node | PrimitiveChild>): Node[] {
  return children.map((child) => {
    if (typeof child === "string" || typeof child === "number") {
      return document.createTextNode(String(child));
    }

    return child;
  });
}

function assignProps(element: HTMLElement, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || value == null) {
      continue;
    }

    if (/^on[A-Z]/.test(key) && isEventHandler(value)) {
      element.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }

    if (typeof value === "boolean") {
      if (value) {
        element.setAttribute(key, key);
      } else {
        element.removeAttribute(key);
      }
      continue;
    }

    element.setAttribute(key, String(value));
  }
}

function createFragment(children: Array<Node | PrimitiveChild>): DocumentFragment {
  const fragment = document.createDocumentFragment();

  for (const child of toDomChildren(children)) {
    fragment.appendChild(child);
  }

  return fragment;
}

function createElement(tag: string, props: Props, children: Array<Node | PrimitiveChild>): Node {
  const domChildren = toDomChildren(children);
  const element = E(tag, null, domChildren) as HTMLElement;

  assignProps(element, props);

  return element;
}

function buildProps(props: Props | null | undefined, children: Array<Node | PrimitiveChild>): Props {
  if (children.length === 0) {
    return props ?? {};
  }

  return {
    ...(props ?? {}),
    children
  };
}

function renderJsx(tag: TagName, props: Props | null | undefined, key: string | number | bigint | undefined): Node {
  void key;
  const nextProps = props ?? {};
  const children = normalizeChildren(nextProps.children ?? []);

  if (tag === Fragment) {
    return createFragment(children);
  }

  if (typeof tag === "function") {
    return tag(buildProps(nextProps, children));
  }

  if (typeof tag !== "string") {
    throw new TypeError("Unsupported JSX tag type");
  }

  return createElement(tag, nextProps, children);
}

export function jsx(tag: TagName, props: Props | null, key?: string | number | bigint): Node {
  return renderJsx(tag, props, key);
}

export function jsxs(tag: TagName, props: Props | null, key?: string | number | bigint): Node {
  return renderJsx(tag, props, key);
}

export function jsxDEV(tag: TagName, props: Props | null, key?: string | number | bigint): Node {
  return renderJsx(tag, props, key);
}

declare global {
  namespace JSX {
    interface ElementChildrenAttribute {
      children: {};
    }

    interface IntrinsicElements {
      [name: string]: {
        children?: ChildValue | ChildValue[];
        [prop: string]: unknown;
      };
    }
  }
}
