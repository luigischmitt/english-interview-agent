type NavigatorLike = Partial<Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">> & { audioSession?: { type?: string } };
export function detectPlatform(nav?: NavigatorLike): "ios" | "android" | "desktop";
export function isIosWebKit(nav?: NavigatorLike): boolean;
export function readAudioSessionType(nav?: NavigatorLike): string | undefined;
export function setAudioSessionType(type: string, nav?: NavigatorLike): boolean;
export function errorNameOf(error: unknown): string;
export function describeMedia(media: unknown): Record<string, number | boolean>;
