import type { ComponentProps, ReactNode } from "react";
import { RibbonButton } from "./RibbonButton";
import { MenuList, type MenuEntry } from "./Menu";
import { Popover, usePopover } from "./Popover";

/** RibbonButton that opens a menu (or any custom panel) beneath itself. */
export function DropdownButton({
  items,
  panel,
  ...button
}: Omit<ComponentProps<typeof RibbonButton>, "onClick" | "caret"> & {
  items?: MenuEntry[];
  panel?: (close: () => void) => ReactNode;
}) {
  const pop = usePopover();
  return (
    <>
      <RibbonButton {...button} caret active={button.active || pop.open} onClick={(el) => pop.toggle(el)} />
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close}>
          {panel ? panel(pop.close) : items && <MenuList items={items} onClose={pop.close} />}
        </Popover>
      )}
    </>
  );
}
