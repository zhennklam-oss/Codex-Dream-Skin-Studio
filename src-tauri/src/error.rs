use serde::Serialize;
use std::fmt::{Display, Formatter};

pub type StudioResult<T> = Result<T, StudioError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudioError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl StudioError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn io(context: &str, error: std::io::Error) -> Self {
        Self::new("IO_ERROR", context).with_detail(error.to_string())
    }

    pub fn json(context: &str, error: serde_json::Error) -> Self {
        Self::new("JSON_ERROR", context).with_detail(error.to_string())
    }

    pub fn code(&self) -> &str {
        &self.code
    }
}

impl Display for StudioError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)?;
        if let Some(detail) = &self.detail {
            write!(formatter, " ({detail})")?;
        }
        Ok(())
    }
}

impl std::error::Error for StudioError {}
