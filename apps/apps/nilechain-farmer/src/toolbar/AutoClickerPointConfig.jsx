import styled from "styled-components";
import { Dialog } from "radix-ui";

const DialogOverlay = styled(Dialog.Overlay)`
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: auto;
  padding: 16px;
  background-color: rgb(0 0 0 / 60%);
  z-index: 99930;
`;

const DialogContent = styled(Dialog.Content)`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 384px;
  gap: 8px;
  padding: 16px;
  background-color: var(--nc-surface-2, #192940);
  color: var(--nc-text, #f0f4fa);
  border: 1px solid var(--nc-border, #2a3d59);
  border-radius: 12px;
  font-family: "Noto Sans";
`;

const DialogTitle = styled(Dialog.Title)`
  font-family: "Noto Sans";
  font-size: 14px;
  font-weight: bold;
  text-align: center;
  color: var(--nc-gold, #D4A843);
  margin: 0;
`;

const DialogDescription = styled(Dialog.Description)`
  font-family: "Noto Sans";
  font-size: 12px;
  text-align: center;
  color: var(--nc-text-muted, #a8bcd4);
  margin: 0;
`;

const DialogClose = styled(Dialog.Close)`
  font-size: 12px;
  font-weight: bold;
  text-align: center;
  background-color: var(--nc-gold, #D4A843);
  color: var(--nc-canvas, #040a14);
  padding: 8px;
  border-radius: 8px;
  border: 0px;
  outline: 0px;
  cursor: pointer;
`;

const Input = styled.input`
  font-size: 12px;
  background-color: var(--nc-surface, #0b1526);
  color: var(--nc-text, #f0f4fa);
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--nc-border, #2a3d59);
  outline: 0px;

  &:focus {
    box-shadow: 0px 0px 2px 2px var(--nc-gold, #D4A843);
  }
`;

const Select = styled.select`
  font-size: 12px;
  background-color: var(--nc-surface, #0b1526);
  color: var(--nc-text, #f0f4fa);
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--nc-border, #2a3d59);
  outline: 0px;
  &:focus {
    box-shadow: 0px 0px 2px 2px var(--nc-gold, #D4A843);
  }
`;

export default function AutoClickerPointConfig({
  point,
  updatePoint,
  onOpenChange,
}) {
  return (
    <Dialog.Root defaultOpen onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <DialogOverlay>
          <DialogContent onOpenAutoFocus={(ev) => ev.preventDefault()}>
            <DialogTitle>Edit Target</DialogTitle>
            <DialogDescription>Configure Interval</DialogDescription>

            <Input
              type="number"
              min={1}
              value={point.interval}
              onChange={(ev) =>
                updatePoint({ ...point, interval: Number(ev.target.value) })
              }
            />

            <Select
              value={point.unit}
              onChange={(ev) =>
                updatePoint({ ...point, unit: ev.target.value })
              }
            >
              <option value={"ms"}>Milliseconds</option>
              <option value={"s"}>Seconds</option>
              <option value={"m"}>Minutes</option>
            </Select>

            <DialogClose>Done</DialogClose>
          </DialogContent>
        </DialogOverlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}



