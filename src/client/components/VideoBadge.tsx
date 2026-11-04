export default function VideoBadge({ className = "bottom-2 left-2" }: { className?: string }) {
  return (
    <span
      className={`absolute ${className} inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm`}
    >
      <span
        aria-hidden
        className="h-0 w-0 translate-x-px border-y-[4px] border-l-[6px] border-y-transparent border-l-white"
      />
      VIDEO
    </span>
  );
}
