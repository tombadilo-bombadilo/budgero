import * as React from 'react';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { useUiStore } from '@shared/store/useUiStore';

interface CategorySelectCellProps {
  categoryID: number;
  onCommit: (newVal: number) => void;
  triggerClassName?: string;
}

export function CategorySelectCell({
  categoryID,
  onCommit,
  triggerClassName,
}: CategorySelectCellProps) {
  const [selectedValue, setSelectedValue] = React.useState(categoryID);
  const { selectedBudget } = useUiStore();

  React.useEffect(() => {
    setSelectedValue(categoryID);
  }, [categoryID]);

  const handleChange = (newCategoryID: number) => {
    setSelectedValue(newCategoryID);
    onCommit(newCategoryID);
  };

  return (
    <SearchableCategorySelect
      budgetId={selectedBudget?.ID || 0}
      selectedCategoryId={selectedValue}
      onCategorySelect={handleChange}
      triggerClassName={triggerClassName}
      popoverContentClassName="!w-[280px] !min-w-[280px]"
    />
  );
}
