import React from 'react';
import { cn } from 'cn';

/**
 * StarBorder จาก React Bits (https://reactbits.dev) ปรับให้เข้าธีม:
 * - ใช้ห่อปุ่มหลักตัวเดียวของหน้า (บันทึกออเดอร์) เป็นแสงดาววิ่งรอบขอบ
 * - เคารพ prefers-reduced-motion: ดาวไม่วิ่ง เหลือขอบทองนิ่ง
 * - สีและพื้นมาจาก token ของธีม ไม่ fix สีดำ/ขาวแบบต้นฉบับ
 */
type StarBorderProps<T extends React.ElementType> = React.ComponentPropsWithoutRef<T> & {
  as?: T;
  className?: string;
  innerClassName?: string;
  children?: React.ReactNode;
  color?: string;
  speed?: React.CSSProperties['animationDuration'];
  thickness?: number;
};

const StarBorder = <T extends React.ElementType = 'div'>({
  as,
  className,
  innerClassName,
  color = 'var(--pm-star)',
  speed = '5s',
  thickness = 2,
  children,
  ...rest
}: StarBorderProps<T>) => {
  const Component = as || 'div';
  const star = { background: `radial-gradient(circle, ${color}, transparent 10%)`, animationDuration: speed };
  return (
    <Component
      className={cn('relative block overflow-hidden rounded-[calc(var(--radius)*1.2)]', className)}
      {...(rest as Record<string, unknown>)}
      style={{ padding: `${thickness}px 0`, ...(rest as { style?: React.CSSProperties }).style }}
    >
      <div aria-hidden className="absolute right-[-250%] bottom-[-11px] z-0 h-1/2 w-[300%] animate-star-movement-bottom rounded-full opacity-70 motion-reduce:hidden" style={star} />
      <div aria-hidden className="absolute top-[-10px] left-[-250%] z-0 h-1/2 w-[300%] animate-star-movement-top rounded-full opacity-70 motion-reduce:hidden" style={star} />
      <div className={cn('relative z-1 rounded-[var(--radius)] border border-star/40', innerClassName)}>{children}</div>
    </Component>
  );
};

export default StarBorder;
