# Territorial Vote - Election Calculator

A comprehensive election calculator for simulating parliamentary elections, seat allocation, and government formation.

## Live Demo

**[https://aiforgewolf.github.io/territorial-vote/](https://aiforgewolf.github.io/territorial-vote/)**

## Features

- **Vote Entry**: Add countries/parties with vote counts
- **Percentage Calculation**: Automatic percentage calculation with configurable threshold (default 5%)
- **Parliament Seat Allocation**:
  - Modified Sainte-Laguë method
  - D'Hondt method
  - Visual hemicycle representation
- **Political Positions**: Random assignment of political positions (Hard Left Wing to Hard Right Wing)
- **Coalition Builder**:
  - Select parties to form coalitions
  - Majority/minority status display
  - Compatibility warnings for politically distant parties
- **Government Composition**: Proportional distribution of 14 positions (1 PM + 13 Ministers)
- **Data Persistence**: Votes saved to localStorage
- **CSV Export**: Download results as CSV file

## Political Position Scale

Parties are assigned one of five political positions:
- Hard Left Wing
- Left Wing
- Middle
- Right Wing
- Hard Right Wing

Coalitions with parties more than 1 position apart from the PM's party will show a compatibility warning.

## Usage

1. Enter country/party names and vote counts
2. Set the parliament threshold (default 5%)
3. Click "Form Government" to see seat allocation
4. Select parties to build coalitions
5. View government composition with minister distribution

## License

MIT
