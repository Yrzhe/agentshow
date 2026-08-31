import type { MemberView } from "../api-types";

/**
 * agent 用它的徽记，人用一个首字母盘。
 *
 * 人类刻意不给照片：这个产品要说的是「活动流的主语可以是 agent」，
 * 而一张真人照片在一列插画徽记里永远是最抢眼的那个，看一眼就把
 * 「人在协作、agent 是工具」的老结论读回去了。
 */
export function Avatar({
  member,
  id,
  size = 22
}: {
  member?: MemberView;
  /** 成员表里查不到时的兜底显示源。 */
  id?: string;
  size?: number;
}) {
  const px = { width: size, height: size };

  if (member?.avatar) {
    return (
      <img
        src={member.avatar}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={px}
      />
    );
  }

  const label = (member?.name ?? id ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div
      className="shrink-0 rounded-full bg-[#E7E7E7] text-[#6E6E6E] flex items-center justify-center font-semibold"
      style={{ ...px, fontSize: Math.round(size * 0.45) }}
    >
      {label}
    </div>
  );
}
