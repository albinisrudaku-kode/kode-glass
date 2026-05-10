import type {ElementBounds} from '../shared/accessibility-report';

export interface FocusPathPoint {
  readonly bounds?: ElementBounds;
  readonly label: string;
  readonly order: number;
  readonly selector: string;
}

export function renderFocusPath(
  svg: SVGSVGElement,
  focusPath: readonly FocusPathPoint[],
): void {
  const visiblePoints = focusPath.filter(point => point.bounds);

  visiblePoints.forEach((point, index) => {
    const bounds = point.bounds;

    if (!bounds) {
      return;
    }

    const centerX = bounds.x - window.scrollX + bounds.width / 2;
    const centerY = bounds.y - window.scrollY + bounds.height / 2;
    const previousBounds = visiblePoints[index - 1]?.bounds;

    if (previousBounds) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(previousBounds.x - window.scrollX + previousBounds.width / 2));
      line.setAttribute('y1', String(previousBounds.y - window.scrollY + previousBounds.height / 2));
      line.setAttribute('x2', String(centerX));
      line.setAttribute('y2', String(centerY));
      line.setAttribute('stroke', '#4f46e5');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '4 4');
      svg.append(line);
    }

    const label = String(point.order);
    const radius = Math.max(10, label.length * 4 + 7);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(centerX));
    circle.setAttribute('cy', String(centerY));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', '#4f46e5');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.textContent = label;
    text.setAttribute('x', String(centerX));
    text.setAttribute('y', String(centerY + 4));
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-family', 'Arial, sans-serif');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-weight', '700');
    text.setAttribute('text-anchor', 'middle');

    svg.append(circle, text);
  });
}
