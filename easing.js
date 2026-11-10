export const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

export const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// Overshoots slightly past 1 before settling: a cartoon "pop".
export const easeOutBack = (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
