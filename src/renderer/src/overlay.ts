import type { IncomingAnnotation } from "../../shared/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const marks = document.getElementById("marks")!;
const labels = document.getElementById("labels")!;
const timers = new Map<string, number>();

function colorFor(id: string): string {
  const colors = ["#ff5c46", "#1d7f68", "#315ce7", "#b34bd3", "#d27b14"];
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function removeMark(id: string): void {
  document.getElementById(`mark-${id}`)?.remove();
  document.getElementById(`label-${id}`)?.remove();
  const timer = timers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  if (!marks.childElementCount) {
    void window.nearview.clearScreenAnnotations();
  }
}

function createLabel(
  id: string,
  x: number,
  y: number,
  color: string,
  name: string
): HTMLDivElement {
  const label = document.createElement("div");
  label.id = `label-${id}`;
  label.className = "annotation-label-chip";
  label.textContent = name;
  label.style.color = color;
  label.style.left =
    x > 0.72 ? `calc(${x * 100}% - 12px)` : `calc(${x * 100}% + 12px)`;
  label.style.top =
    y < 0.2 ? `calc(${y * 100}% + 15px)` : `calc(${y * 100}% - 15px)`;
  label.style.transform =
    x > 0.72 ? "translate(-100%, -50%)" : "translate(0, -50%)";
  return label;
}

function show(annotation: IncomingAnnotation): void {
  document.getElementById(`mark-${annotation.id}`)?.remove();
  document.getElementById(`label-${annotation.id}`)?.remove();
  const group = document.createElementNS(SVG_NS, "g");
  group.id = `mark-${annotation.id}`;
  const color = colorFor(annotation.fromPeerId);

  if (annotation.tool === "pulse") {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("class", "pulse");
    circle.setAttribute("cx", String(annotation.x1 * 100));
    circle.setAttribute("cy", String(annotation.y1 * 100));
    circle.setAttribute("r", "2.2");
    circle.setAttribute("fill", color);
    circle.setAttribute("stroke", color);
    group.append(circle);
    labels.append(
      createLabel(
        annotation.id,
        annotation.x1,
        annotation.y1,
        color,
        annotation.fromPeerName
      )
    );
  } else {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(annotation.x1 * 100));
    line.setAttribute("y1", String(annotation.y1 * 100));
    line.setAttribute("x2", String(annotation.x2 * 100));
    line.setAttribute("y2", String(annotation.y2 * 100));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "0.65");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    line.setAttribute("marker-end", "url(#arrow)");
    group.append(line);
    labels.append(
      createLabel(
        annotation.id,
        annotation.x2,
        annotation.y2,
        color,
        annotation.fromPeerName
      )
    );
  }

  marks.append(group);
  const duration = annotation.tool === "pulse" ? 2_800 : 5_500;
  timers.set(
    annotation.id,
    window.setTimeout(() => removeMark(annotation.id), duration)
  );
}

window.nearview.onScreenAnnotation(show);
window.nearview.onScreenAnnotationsClear(() => {
  for (const timer of timers.values()) {
    window.clearTimeout(timer);
  }
  timers.clear();
  marks.replaceChildren();
  labels.replaceChildren();
});
