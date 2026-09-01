import type { FileKind } from "./format";

/**
 * 设计稿里用到的图标，全部内联。
 *
 * 不引图标库：这里一共十来个形状，一个包换来的是几百个用不到的图标
 * 和一次额外的构建依赖。
 */

type IconProps = { size?: number; color?: string; width?: number };

/**
 * 一律 aria-hidden。这些形状没有一个是独立的信息 —— 它们要么挨着文字，
 * 要么装在按钮里，而按钮的名字由 aria-label 给。不挡住的话，读屏软件
 * 会在每个标签旁边多念一个「图形」。
 */
function svg(size: number, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** 描边图标共用的收尾方式，和设计稿一致。 */
function stroke(color: string, width: number) {
  return {
    fill: "none",
    stroke: color,
    strokeWidth: width,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
}

export function ComposeIcon({ size = 14, color = "#555555" }: IconProps) {
  const s = stroke(color, 2);
  return svg(
    size,
    <>
      <path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" {...s} />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L13 14l-4 1 1-4Z" {...s} />
    </>
  );
}

export function BotIcon({ size = 14, color = "#555555" }: IconProps) {
  const s = stroke(color, 2);
  return svg(
    size,
    <>
      <path d="M12 7V4" {...s} />
      <circle cx="12" cy="3" r="1" {...s} />
      <rect x="4" y="7" width="16" height="12" rx="3" {...s} />
      <path d="M2 13h2" {...s} />
      <path d="M20 13h2" {...s} />
      <path d="M9 12v2" {...s} />
      <path d="M15 12v2" {...s} />
    </>
  );
}

export function FolderIcon({ size = 14, color = "#555555" }: IconProps) {
  const s = stroke(color, 2);
  return svg(
    size,
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2Z" {...s} />
  );
}

export function HomeIcon({ size = 12, color = "#555555" }: IconProps) {
  const s = stroke(color, 2.1);
  return svg(
    size,
    <>
      <path d="M3 10.5 12 3l9 7.5" {...s} />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" {...s} />
    </>
  );
}

export function PlusIcon({ size = 13, color = "#999999", width = 2.2 }: IconProps) {
  const s = stroke(color, width);
  return svg(
    size,
    <>
      <path d="M12 5v14" {...s} />
      <path d="M5 12h14" {...s} />
    </>
  );
}

export function ChevronDownIcon({ size = 11, color = "#999999" }: IconProps) {
  return svg(size, <path d="m6 9 6 6 6-6" {...stroke(color, 2.2)} />);
}

export function SendIcon({ size = 13, color = "#FFFFFF" }: IconProps) {
  const s = stroke(color, 2.4);
  return svg(
    size,
    <>
      <path d="M12 19V5" {...s} />
      <path d="m5 12 7-7 7 7" {...s} />
    </>
  );
}

export function ArrowLeftIcon({ size = 14, color = "#555555" }: IconProps) {
  const s = stroke(color, 2.1);
  return svg(
    size,
    <>
      <path d="M19 12H5" {...s} />
      <path d="m12 19-7-7 7-7" {...s} />
    </>
  );
}

/** 文件图标：外框一样，内部符号区分类型，颜色也跟着类型走。 */
export function FileIcon({ kind, color, size = 15 }: { kind: FileKind; color: string; size?: number }) {
  const s = stroke(color, 1.8);
  const inner = {
    code: (
      <>
        <path d="M10 12.5 8 14.5l2 2" {...s} />
        <path d="M14 12.5l2 2-2 2" {...s} />
      </>
    ),
    doc: (
      <>
        <path d="M8 13h8" {...s} />
        <path d="M8 17h5" {...s} />
      </>
    ),
    sheet: (
      <>
        <path d="M8 12h8" {...s} />
        <path d="M8 16h8" {...s} />
        <path d="M12 12v8" {...s} />
      </>
    ),
    other: null
  }[kind];

  return svg(
    size,
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" {...s} />
      <path d="M14 2v6h6" {...s} />
      {inner}
    </>
  );
}

/** 产品标记。深色单色，24px 以下也不糊。 */
export function Logo({ size = 23 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 144 144"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        d="m54 35.6c0.2-0.1 0.2-0.9 0-1-6.2-2.8-17-7.2-26.8-8.3-7.4-0.8-12.3 0.2-15.2 2.8-2.4 2.1-3.9 5.3-3 9.4 1.2 5.5 4.7 11.1 10.1 17.6 7 8.2 17.1 16.5 27.8 24 14.1 9.9 30.3 18.5 43.2 23.9 6.7 2.6 18.9 6.7 28.8 7.9 7.1 0.6 17-0.6 17-9.3 0-6.8-4.7-13.6-11.2-20.7l-3.6-3.9-1 0.2v0.3c3.4 4 5.9 7.2 8 12.1 2.5 8.3-2.6 11.6-6.9 13-5.1 1-11.8 0.3-19.2-1.5-18.1-4.8-35.9-15-46-21.6-9.6-6.5-21.6-16.3-28.9-25.5l-3.2-4.4c-2.2-3.6-4.5-8.4-4.3-12.6 0.1-2.1 1.9-6.6 10.4-7 6.7-0.4 13.8 1.3 23 4.2h0.5"
        fill="#171819"
      />
      <path
        d="m53 87.7c-7 0.4-13-2.8-16.1-10.6l-0.4-1.4c-3.5-2.7-7.9-6.4-10.8-9-0.2 1.4-0.2 3.8-0.1 5.5 0.4 5 2.6 12.2 7.5 17.2 4.1 4.2 10.4 8.7 19.8 9.2h19.1v-0.2c-5.3-2.6-11.9-6.5-18.9-10.7h-0.1z"
        fill="#171819"
      />
      <path
        d="m99.8 41.4c-3.4-1.5-6.8-5.2-12.2-7.9-5-2.4-9.5-3.4-14.7-3.4s-10.8 1.8-12.9 2.8c-4.4 2.5-7.5 6.1-10.9 7.5-4.1 1.8-7.9 3.3-11 5.4-3.2 2.3-6 5.2-8.3 8.8 1.9 2.4 5 5.4 7.5 8 1.4-3.8 4.1-7 7-8.9 2.2-1.5 5-2.3 7.3-3.2 2.5-0.9 6-3.8 9-6.5 3.4-2.8 7.6-4 11.8-4 5.6-0.1 11.4 1.9 16.8 6.6 1.5 1.4 1.8 1.5 6.6 4 1.6 0.8 2.4 1 3.2 1.3 9.7 4.5 13 14.6 9.9 23.3-2.2 6-7.3 12.5-17.4 12.5h-17.3l0.1 0.2c5.2 2.9 15.4 7.3 22.5 9.8 4.8-1.1 6.8-2.1 10.4-4.3 4-2.3 6.5-5 8.4-8.4 1.8-3.1 3.8-9.1 3.8-15.6 0-9.3-4.8-16.7-9.7-21.4-3.1-2.8-7.6-5.4-10-6.3l0.1-0.3z"
        fill="#171819"
      />
      <path
        d="m61.5 54.8c-3 0-5.1 2.3-5.1 5s2.1 5.2 4.9 5.2c2.8 0.1 5.1-2.1 5.1-5 0-2.8-2.3-5.3-4.9-5.2zm23.6 0c-2.6 0-5.1 2.1-5.1 5.1s2.4 5.1 5.1 5.1c2.9 0.1 4.9-2.6 4.9-5.1 0.1-2.8-2-5.2-4.9-5.1z"
        fill="#171819"
      />
      <path
        d="m28.1 95c-0.1 0-0.1 3.6-0.9 6-1.1 2.4-3.8 2-7.4 2.7 5.6 0.5 6.8 0.8 7.6 3 0.6 1.8 0.6 5.5 0.7 5.5s0.2-4.5 1-5.8c1.1-2.3 3-2.2 7.2-2.7-6.1-0.6-7.3-0.6-7.9-5.1l-0.3-3.6zm66.5-68.6c6 0.5 7.9 0.5 8.3-4.5l0.3-4c0.4 6.5 1 7.6 4.6 8l3.8 0.5c-5.4 0.5-7.4 0.5-8 4.8l-0.4 3.5c-0.7-6.8-0.3-7.5-8.6-8.3zm5.3 94c4.5-0.4 4.8-0.3 5.3-5.5 0.4 4.8 0 4.8 5.6 5.5-4.4 0.3-5 0.7-5.4 5.6-0.2-5.5-1.2-5.4-5.5-5.6z"
        fill="#171819"
      />
    </svg>
  );
}
