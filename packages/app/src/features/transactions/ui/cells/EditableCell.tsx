import React from 'react';
import { Input } from '@shared/ui/input';
import { cn } from '@shared/lib/utils';
import { buttonizeProps } from '@shared/lib/a11y';

interface EditableCellProps {
  value: string | number | undefined; // The actual data value from your table
  onCommit: (val: string | number) => void; // Callback with the new value (string from input)
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string; // Placeholder for the input field when editing
  className?: string; // Optional wrapper class overrides
  displayClassName?: string; // Optional display-state text class
  inputClassName?: string; // Optional input class overrides
}

export function EditableCell({
  value: initialValueProp,
  onCommit,
  type = 'text',
  placeholder = 'Enter value...',
  className,
  displayClassName,
  inputClassName,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  // Internal state for the input, initialized from the prop. Input value is always string.
  const [currentValue, setCurrentValue] = React.useState(String(initialValueProp ?? ''));

  React.useEffect(() => {
    setCurrentValue(String(initialValueProp ?? ''));
  }, [initialValueProp]);

  React.useEffect(() => {
    return () => {
      document.body.classList.remove('input-active');
    };
  }, []);

  const handleEditClick = () => {
    // Ensure currentValue is up-to-date with prop when starting edit
    setCurrentValue(String(initialValueProp ?? ''));
    setIsEditing(true);

    // Add class to prevent layout shifts on mobile
    document.body.classList.add('input-active');
  };

  const handleCommit = () => {
    setIsEditing(false);
    // `currentValue` is the string from the input.
    // The parent component (useTransactionTable via onCommit) handles type conversion.
    onCommit(currentValue);

    // Remove class after a small delay to allow smooth transition
    setTimeout(() => {
      document.body.classList.remove('input-active');
    }, 100);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setCurrentValue(String(initialValueProp ?? ''));

    // Remove class after a small delay to allow smooth transition
    setTimeout(() => {
      document.body.classList.remove('input-active');
    }, 100);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentValue(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <Input
        autoFocus
        type={type}
        value={currentValue}
        onChange={handleInputChange}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          'w-full h-10 text-sm truncate text-ellipsis', // Standard input height, allows default padding
          inputClassName
        )}
      />
    );
  }

  // Display view
  const valueForDisplay = initialValueProp ?? '';
  const displayContent: React.ReactNode = String(valueForDisplay);

  const isEmptyDisplay = typeof displayContent === 'string' && displayContent.trim() === '';

  return (
    <div
      className={cn(
        'cursor-pointer w-full flex items-center text-sm',
        'h-10', // Match Input height for visual consistency & click area
        // Apply padding to align text similarly to Input's internal padding (px-3)
        'justify-start pl-3 truncate',
        className
      )}
      {...buttonizeProps(handleEditClick)}
      title={String(initialValueProp ?? '') || 'Click to edit'}
    >
      {isEmptyDisplay ? (
        // Render a placeholder for empty content to ensure clickability and indicate emptiness
        <span className={cn('italic text-muted-foreground', displayClassName)}>--</span>
      ) : (
        <span className={cn('truncate', displayClassName)}>{displayContent}</span>
      )}
    </div>
  );
}
