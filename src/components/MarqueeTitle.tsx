import { useEffect, useRef, useState } from "react";
/** Only overflowed, visible titles move. The complete text remains accessible. */
export function MarqueeTitle({ text }: { text: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el=root.current!;
    const measure=()=>setDistance(Math.max(0,(el.firstElementChild as HTMLElement).scrollWidth-el.clientWidth));
    const resize=new ResizeObserver(measure);resize.observe(el);measure();
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));observer.observe(el);
    return ()=>{resize.disconnect();observer.disconnect()};
  },[text]);
  return <span ref={root} className={"marquee-title"+(distance>1&&visible?" marquee-active":"")} style={{"--marquee-distance":`-${distance}px`,"--marquee-duration":`${Math.max(7,distance/28+4)}s`} as React.CSSProperties}><span>{text}</span></span>;
}
