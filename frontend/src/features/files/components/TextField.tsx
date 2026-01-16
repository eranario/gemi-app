interface TextFieldProps {
  id: string;
  label: string;
  type?: "text" | "date";
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function TextField({
  id,
  label,
  type = "text",
  placeholder,
  value,
  onChange,
}: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  );
}
