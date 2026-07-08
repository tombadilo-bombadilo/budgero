import type { SVGProps } from 'react';

/**
 * Fluent MDL2 "Feedback" glyph (source: iconify fluent-mdl2:feedback).
 * Inlined as a component so it can be used like a lucide icon — pass
 * `className="h-4 w-4"` for sizing; it inherits color via currentColor.
 */
export function FeedbackIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 2048 2048"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={56}
        strokeLinejoin="round"
        d="M958 1328q101 40 184 106t142 153t91 187t33 210v64h-128v-64q0-119-45-224t-124-183t-183-123t-224-46q-119 0-224 45t-183 124t-123 183t-46 224v64H0v-64q0-109 32-210t92-187t142-152t184-107q-45-31-81-72t-61-88t-38-100t-14-108q0-93 35-174t96-142t142-96t175-36q93 0 174 35t142 96t96 142t36 175q0 55-13 107t-39 100t-61 89t-81 72m-254-48q66 0 124-25t101-68t69-102t26-125t-25-124t-69-101t-102-69t-124-26t-124 25t-102 69t-69 102t-25 124t25 124t68 102t102 69t125 25M2048 0v1024h-256l-384 384v-384h-128V896h256v203l203-203h181V128H640v230q-32 4-64 10t-64 18V0z"
      />
    </svg>
  );
}
